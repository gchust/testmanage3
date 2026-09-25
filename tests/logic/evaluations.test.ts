import { buildFilter } from '@nocobase/repository-input';
import { createDriveManager } from '@nocobase/drive';
import { ServerFileRepositoryManager } from '@nocobase/app-plugin-file/server';
import { EvaluationArchive } from '../../server/providers/evaluations/archive.js';
// @vitest-environment node
import { createDatabaseManager, type MigrationContext } from '@nocobase/db';
import { sqlite } from '@nocobase/db-sqlite';
import {
  authenticationToken,
  type Auth,
} from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import type { Application } from '@nocobase/app-server/application';
import { ServiceContainer } from '@nocobase/service-provider';
import type { ApiKeyService } from '@nocobase/app-plugin-api-keys/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { Hono, type Context } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import migration from '../../database/main/migrations/202609250001_create_evaluations.js';
import issuesMigration from '../../database/main/migrations/202609210003_create_issues.js';
import issueTypesMigration from '../../database/main/migrations/202609220001_add_issue_type_and_owner.js';
import activityMigration from '../../database/main/migrations/202609220003_create_problem_activities.js';
import factoryMigration from '../../database/main/migrations/202609250002_collect_factory_problems.js';
import linkMigration from '../../database/main/migrations/202609250003_reference_factory_reports.js';
import { createTestProgressService } from '../../server/providers/test-progress.js';
import {
  factoryProblemSource,
  type SubmittedProblem,
} from '../../server/providers/evaluations/problems.js';
import {
  EvaluationService,
  type SourceBinding,
} from '../../server/providers/evaluations/service.js';
import {
  deliveryKey,
  hash,
  subjectOf,
  subjectId,
  validateDocument,
  precedenceRank,
  type EvaluationDocument,
} from '../../server/providers/evaluations/protocol.js';
import type { EvaluationReport } from '../../server/providers/evaluations/document.js';
import { readArchive } from '../../server/providers/evaluations/archive.js';
import { parseLinkedReport } from '../../server/providers/evaluations/report-links.js';
import reportFixture from '../fixtures/factory-report.json';
import originalPermissionSeed from '../../database/main/seeds/202609250001_seed_evaluation_permissions.js';
import retirePermissionSeed from '../../database/main/seeds/202609250002_retire_evaluation_permissions.js';
import { evaluationRoutes } from '../../server/routes/evaluations.js';
import { evaluationServiceToken } from '../../server/providers/evaluations/index.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
const source: SourceBinding = {
  id: 'integration',
  apiKeyId: 'key',
  sourceInstance: 'owner/factory',
  project: 'owner/factory',
  name: 'Contract test',
  enabled: true,
  createdBy: 'admin',
};
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK9sAAAAASUVORK5CYII=',
  'base64',
);
function report(): EvaluationReport {
  return validateDocument(structuredClone(reportFixture)) as EvaluationReport;
}
function batch(): EvaluationDocument {
  return {
    schemaVersion: 1,
    type: 'evaluation-batch',
    revision: 1,
    source: report().source,
    batch: {
      subjectKey: 'owner/factory/batches/nb3-daily-smoke-20260925',
      sequence: 4,
    },
  };
}
/** Problems are explicitly supplied by Actions; no local finding/QA selection. */
function submittedProblems(d: EvaluationDocument): SubmittedProblem[] {
  return d.type === 'evaluation-report'
    ? [
        {
          key: hash('fixture-finding'),
          title: 'Factory reported problem',
          description: 'Steps and evidence',
          subjectKeys: [],
          findingIds: [d.reviews[0].findings[0].id],
        },
      ]
    : [];
}

/** Minimal independent protocol writer; intentionally allows malformed names for negative tests. */
function zip(entries: Array<{ path: string; data: Buffer }>): Buffer {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const file of entries) {
    const name = Buffer.from(file.path),
      header = Buffer.alloc(30),
      directory = Buffer.alloc(46),
      crc = crc32(file.data) >>> 0;
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(file.data.length, 18);
    header.writeUInt32LE(file.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(0x314, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(file.data.length, 20);
    directory.writeUInt32LE(file.data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    local.push(header, name, file.data);
    central.push(directory, name);
    offset += header.length + name.length + file.data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function packet(original: EvaluationDocument) {
  const document = structuredClone(original);
  const headers = {
    version: '1',
    type: document.type,
    sha256: hash(JSON.stringify(document)),
    idempotencyKey: deliveryKey(subjectOf(document)),
  };
  return { document, headers };
}
async function linkedInput(
  p: ReturnType<typeof packet>,
  problems = submittedProblems(p.document),
) {
  const request = linkedRequest(p, 'integration-secret', { problems });
  return parseLinkedReport(Buffer.from(await request.arrayBuffer()), {
    ...p.headers,
    payloadSha256: request.headers.get('X-Evaluation-Payload-SHA256')!,
  });
}

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'testmanage3-evaluations-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const db = createDatabaseManager({
    default: 'main',
    connections: { main: sqlite({ filename: path.join(root, 'db.sqlite') }) },
  });
  cleanup.push(() => db.destroy());
  const context = {
    builder: db.builder(),
    query: db.query(),
    connection: db.connection(),
  } as unknown as MigrationContext;
  await migration.up(context);
  await db.builder().createCollection('user', (c) => {
    c.string('id', { primaryKey: true });
    c.datetime('disabledAt');
    c.datetime('deletedAt');
    c.string('name');
    c.string('username');
    c.string('email');
  });
  await db.builder().createCollection('featurePoints', (c) => {
    c.increments('id');
    c.string('level');
    c.string('name');
    c.integer('designScore');
  });
  await issuesMigration.up(context);
  await issueTypesMigration.up(context);
  await activityMigration.up(context);
  await db.builder().alterCollection('issues', (c) => {
    c.string('ownerId');
  });
  await factoryMigration.up(context);
  await linkMigration.up(context);
  await db.query().insertInto('user').values({ id: 'admin' }).execute();
  await db
    .query()
    .insertInto('featurePoints')
    .values({
      id: 1,
      level: 'feature',
      name: 'Existing feature',
      designScore: 8,
    })
    .execute();
  await db
    .query()
    .insertInto('issues')
    .values({
      id: 1,
      title: 'Existing problem',
      status: 'fixing',
      owner: 'Human',
      featurePointId: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .execute();
  await db
    .query()
    .insertInto('evaluationSources')
    .values({ ...source, createdAt: new Date() })
    .execute();
  const keys = {
    verify: async (secret: string) =>
      secret === 'integration-secret' ? { id: 'key' } : null,
  } as unknown as ApiKeyService;
  const drive = createDriveManager({
    default: 'local',
    disks: {
      local: {
        driver: 'fs',
        location: path.join(root, 'archive'),
        visibility: 'private',
      },
    },
  });
  const archive = new EvaluationArchive(
    new ServerFileRepositoryManager(db, drive),
    drive,
  );
  const service = new EvaluationService(db, archive, keys);
  const save = async (
    document: EvaluationDocument,
    problems = submittedProblems(document),
  ) =>
    service.importLinkedReport(
      source,
      await linkedInput(packet(document), problems),
    );
  // Historical files are fixture data, not a still-supported upload API.
  const legacy = async (document: EvaluationDocument) => {
    const p = packet(document);
    const entries = [
      { path: 'evaluation.json', data: Buffer.from(JSON.stringify(document)) },
      {
        path: 'report.html',
        data: Buffer.from('<html>Original archived report</html>'),
      },
    ];
    const bytes = zip(entries);
    p.headers.sha256 = hash(bytes);
    const id = 'historical-receipt';
    const receipt = {
      receiptId: id,
      sourceInstance: source.sourceInstance,
      runKey: subjectOf(document).key,
      revision: document.revision,
      bundleSha256: hash(bytes),
      state: 'stored',
    };
    const files = new ServerFileRepositoryManager(db, drive).repository(
      'evaluationBundleFiles',
      {
        connection: 'main',
        disk: 'local',
        accessPath: '/evaluations/archive',
        policy: { read: true, create: true, update: false, delete: false },
      },
    );
    const { record } = await files.uploadOne({
      file: new File([new Uint8Array(bytes)], 'legacy.zip', {
        type: 'application/zip',
      }),
    });
    await db
      .query()
      .insertInto('evaluationReports')
      .values({
        id,
        sourceInstance: source.sourceInstance,
        project: source.project,
        type: document.type,
        subjectKey: subjectOf(document).key,
        revision: document.revision,
        idempotencyKey: p.headers.idempotencyKey,
        bundleSha256: hash(bytes),
        bundleFileId: record.id,
        reportUrl: null,
        rank: precedenceRank(document),
        document: JSON.stringify(document),
        manifest: JSON.stringify({
          files: entries.map(({ path }) => ({ path })),
        }),
        receipt: JSON.stringify(receipt),
        receivedAt: new Date(),
      })
      .execute();
    await db
      .query()
      .insertInto('evaluationSubjects')
      .values({
        id: subjectId(document),
        sourceInstance: source.sourceInstance,
        type: document.type,
        subjectKey: subjectOf(document).key,
        currentReportId: id,
        rank: precedenceRank(document),
        updatedAt: new Date(),
      })
      .execute();
    return { p, bytes, receipt };
  };
  return { db, service, save, context, root, archive, legacy };
}

async function router(service: EvaluationService) {
  const container = new ServiceContainer();
  container.instance(evaluationServiceToken, service);
  const auth = {
    required: () => async (c: Context, next: () => Promise<void>) => {
      if (!c.req.header('x-user')) return c.json({ code: 'UNAUTHORIZED' }, 401);
      c.set('auth', { user: { id: 'admin' } });
      await next();
    },
  } as unknown as Auth;
  container.instance(authenticationToken, auth);
  container.instance(authorizationToken, {
    middleware: () => async (c: Context, next: () => Promise<void>) => {
      c.set('authz', {
        authorize: async ({ action }: { action: string }) => ({
          effect:
            c.req.header('x-user') === 'admin' ||
            (c.req.header('x-user') === 'reader' && action === 'read')
              ? 'permit'
              : 'deny',
          conditions: {
            type: 'resource',
            database: Object.fromEntries(
              [
                'evaluationReports',
                'evaluationSubjects',
                'evaluationMappings',
                'evaluationFindings',
                'evaluationRegressions',
                'evaluationSources',
                'evaluationAudit',
                'featurePoints',
                'issues',
              ].map((name) => [
                name,
                { read: true, create: true, update: true, delete: true },
              ]),
            ),
          },
        }),
        can: async ({ action }: { action: string }) =>
          c.req.header('x-user') === 'admin' ||
          (c.req.header('x-user') === 'reader' && action === 'read'),
      });
      await next();
    },
  } as unknown as ReturnType<
    typeof container.resolve<typeof authorizationToken>
  >);
  return evaluationRoutes.createRouter({ container } as Application);
}
describe('legacy archive reading', () => {
  it.each([
    '../outside',
    '/evaluation.json',
    'evidence/../escape.png',
    'evidence//escape.png',
    'C:/escape.png',
    'evidence/a\\b.png',
  ])('rejects unsafe path %s', (name) => {
    expect(() => readArchive(zip([{ path: name, data: png }]))).toThrow();
  });
  it('rejects duplicate files, forged local metadata, symlinks, compression, CRC and trailing bytes', () => {
    const one = zip([{ path: 'evaluation.json', data: Buffer.from('{}') }]);
    const central = one.readUInt32LE(one.length - 6);
    const bad = [
      Buffer.concat([one, Buffer.from('x')]),
      zip([
        { path: 'evaluation.json', data: png },
        { path: 'evaluation.json', data: png },
      ]),
    ];
    for (const mutate of [
      (b: Buffer) => b.writeUInt32LE(100, 18),
      (b: Buffer) => b.writeUInt32LE((0o120777 << 16) >>> 0, central + 38),
      (b: Buffer) => b.writeUInt16LE(8, central + 10),
      (b: Buffer) => b.writeUInt16LE(1, central + 8),
      (b: Buffer) => b.writeUInt32LE(0, central + 16),
    ]) {
      const b = Buffer.from(one);
      mutate(b);
      bad.push(b);
    }
    for (const bytes of bad) expect(() => readArchive(bytes)).toThrow();
  });
});

describe('factory problem reception', () => {
  it('keeps source Issue, code PR and known factory preview URLs distinct', async () => {
    const d = await report();
    expect(factoryProblemSource('id', d, []).environmentUrl).toBeNull();
    d.source.instance = 'gchust/nb3-factory';
    d.run.task.repository = 'gchust/nb3-factory';
    expect(factoryProblemSource('id', d, [])).toMatchObject({
      issueUrl: 'https://github.com/gchust/nb3-factory/issues/146',
      pullRequestUrl: 'https://github.com/gchust/nb3-factory/pull/150',
      environmentUrl: 'https://nb3-150.nfvd.net/main/',
    });
    d.outcome.pullRequest = null;
    expect(factoryProblemSource('id', d, []).environmentUrl).toBeNull();
  });

  it('collects submitted problems into the ordinary list with source and report links', async () => {
    const { save, db } = await setup();
    const d = report();
    const received = await save(d);
    const tracker = createTestProgressService(db);
    const [problem] = await tracker.listProblems({ type: 'automation' });
    expect(problem).toMatchObject({
      title: submittedProblems(d)[0].title,
      featurePointId: null,
      status: 'pending',
    });
    expect(problem.factorySource).toMatchObject({
      issueUrl: 'https://github.com/owner/factory/issues/146',
      pullRequestUrl: 'https://github.com/owner/factory/pull/150',
      reportId: received.receipt.receiptId,
      hasArchive: false,
    });
    expect((await tracker.getProblem(problem.id)).factorySource).toEqual(
      problem.factorySource,
    );
    expect(await tracker.listProblemActivities(problem.id)).toEqual([
      expect.objectContaining({ actorName: 'GitHub Actions', kind: 'created' }),
    ]);
  });

  it('deduplicates deliveries and reassessments without overwriting human edits', async () => {
    const { save, db } = await setup();
    const d = await report();
    const first = await save(d);
    const original = await db
      .query()
      .selectFrom('issues')
      .selectAll()
      .where('type', '=', 'automation')
      .executeTakeFirstOrThrow();
    await db
      .query()
      .updateTable('issues')
      .set({
        title: 'Human title',
        description: 'Human notes',
        status: 'verified',
        owner: 'Reviewer',
      })
      .where('id', '=', Number(original.id))
      .execute();
    expect((await save(d)).duplicate).toBe(true);
    d.revision++;
    d.precedence.producer.runId++;
    d.reviews[0].findings[0].id += '-reassessment';
    const next = await save(d);
    const rows = await db
      .query()
      .selectFrom('issues')
      .selectAll()
      .where('type', '=', 'automation')
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Human title',
      description: 'Human notes',
      status: 'verified',
      owner: 'Reviewer',
      factoryReportId: next.receipt.receiptId,
    });
    expect(first.receipt.receiptId).not.toBe(next.receipt.receiptId);
  });

  it('does not recreate deleted problems when reports are replayed or revised', async () => {
    const { save, db } = await setup();
    const document = await report();
    await save(document);
    await db
      .query()
      .deleteFrom('issues')
      .where('type', '=', 'automation')
      .execute();
    await save(document);
    document.revision++;
    document.precedence.producer.runId++;
    await save(document);
    expect(
      await db
        .query()
        .selectFrom('issues')
        .selectAll()
        .where('type', '=', 'automation')
        .execute(),
    ).toEqual([]);
  });

  it('honors historical human dispositions without creating or updating review rows', async () => {
    const { save, db } = await setup();
    const document = await report();
    const finding = document.reviews
      .flatMap((review) => review.findings)
      .find(
        (item) => item.id === submittedProblems(document)[0].findingIds[0],
      )!;
    const id = hash(
      [document.source.instance, document.run.key, finding.id].join('\n'),
    );
    await db
      .query()
      .insertInto('evaluationFindings')
      .values({
        id,
        sourceInstance: document.source.instance,
        runKey: document.run.key,
        findingId: finding.id,
        reportId: 'historical-report',
        finding: JSON.stringify(finding),
        status: 'ignored',
        note: 'Human disposition',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute();
    const before = await db
      .query()
      .selectFrom('evaluationFindings')
      .selectAll()
      .execute();
    await save(document);
    expect(
      await db
        .query()
        .selectFrom('issues')
        .selectAll()
        .where('type', '=', 'automation')
        .execute(),
    ).toEqual([]);
    expect(
      await db.query().selectFrom('evaluationFindings').selectAll().execute(),
    ).toEqual(before);
  });

  it('accepts explicit QA references and creates no problems from an empty submission', async () => {
    const { save, db } = await setup();
    const d = report();
    await save(d, []);
    expect(
      await createTestProgressService(db).listProblems({ type: 'automation' }),
    ).toEqual([]);
    d.revision++;
    await save(d, [
      {
        ...submittedProblems(d)[0],
        findingIds: [],
        qaCriterionId: d.qa.criteria[0].id,
      },
    ]);
    expect(
      await createTestProgressService(db).listProblems({ type: 'automation' }),
    ).toHaveLength(1);
  });

  it('does not create problems from superseded reports', async () => {
    const { save, db } = await setup();
    const current = await report();
    current.precedence.producer.runId += 10;
    await save(current, []);
    const old = await report();
    old.revision = 2;
    await save(old);
    await save(old);
    expect(
      await db
        .query()
        .selectFrom('issues')
        .selectAll()
        .where('type', '=', 'automation')
        .execute(),
    ).toHaveLength(0);
  });

  it('rolls back the report and receipt if problem persistence fails', async () => {
    const { save, db } = await setup();
    await db.builder().dropCollection('problemActivities');
    await expect(save(await report())).rejects.toThrow();
    expect(
      await db.query().selectFrom('evaluationReports').selectAll().execute(),
    ).toHaveLength(0);
    expect(
      await db
        .query()
        .selectFrom('issues')
        .selectAll()
        .where('type', '=', 'automation')
        .execute(),
    ).toHaveLength(0);
  });

  it('reverses factory columns safely and refuses to discard uncategorized problems', async () => {
    const { save, db, context } = await setup();
    await save(await report());
    await expect(factoryMigration.down!(context)).rejects.toThrow('Classify');
    await db
      .query()
      .updateTable('issues')
      .set({ featurePointId: 1 })
      .where('featurePointId', 'is', null)
      .execute();
    await factoryMigration.down!(context);
    expect(
      (await db.query().selectFrom('issues').selectAll().execute())[0],
    ).not.toHaveProperty('factoryKey');
    await factoryMigration.up(context);

    expect(
      await db.query().selectFrom('issues').selectAll().execute(),
    ).toHaveLength(2);
  });

  it('keeps one persistent receipt for concurrent retries and rejects same-key changed data', async () => {
    const { service, db, archive } = await setup();
    const input = await linkedInput(packet(report()));
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.importLinkedReport(source, input),
      ),
    );
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(results.map((r) => r.receipt.receiptId)).size).toBe(1);
    expect(
      await db
        .query()
        .selectFrom('evaluationBundleFiles')
        .selectAll()
        .execute(),
    ).toEqual([]);
    const restart = new EvaluationService(db, archive);
    expect((await restart.importLinkedReport(source, input)).receipt).toEqual(
      results[0].receipt,
    );
    await expect(
      service.importLinkedReport(source, { ...input, sha256: 'f'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('never lets a larger late revision replace the current problem report', async () => {
    const { save, db } = await setup();
    const best = await save(await report());
    const late = report();
    late.revision = 99;
    late.precedence.producer.runId--;
    await save(late);
    const current = await db
      .query()
      .selectFrom('evaluationSubjects')
      .select('currentReportId')
      .executeTakeFirstOrThrow();
    expect(current.currentReportId).toBe(best.receipt.receiptId);
    const nextDocument = await report();
    nextDocument.revision = 3;
    const next = await save(nextDocument);
    const problem = await db
      .query()
      .selectFrom('issues')
      .select('factoryReportId')
      .where('type', '=', 'automation')
      .executeTakeFirstOrThrow();
    expect(problem.factoryReportId).toBe(next.receipt.receiptId);
  });

  it('preserves source bindings and immediately revokes a disabled owner or integration', async () => {
    const { service, db } = await setup(),
      p = packet(await report());
    await expect(
      service.importLinkedReport(
        { ...source, project: 'other/repo' },
        await linkedInput(p),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await service.authenticate('integration-secret')).not.toBeNull();
    expect(await service.authenticate('wrong')).toBeNull();
    await db
      .query()
      .updateTable('user')
      .set({ disabledAt: new Date() })
      .where('id', '=', 'admin')
      .execute();
    expect(await service.authenticate('integration-secret')).toBeNull();
    await db
      .query()
      .updateTable('evaluationSources')
      .set({ enabled: false })
      .where('id', '=', source.id)
      .execute();
    await expect(
      service.importLinkedReport(source, await linkedInput(p)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('preserves manual scores and existing issues without creating review or regression records', async () => {
    const { save, db } = await setup();
    await save(await report());
    expect(
      await db
        .query()
        .selectFrom('issues')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirst(),
    ).toMatchObject({ status: 'fixing', owner: 'Human' });
    expect(
      await db
        .query()
        .selectFrom('featurePoints')
        .selectAll()
        .executeTakeFirst(),
    ).toMatchObject({ designScore: 8 });
    for (const table of [
      'evaluationFindings',
      'evaluationMappings',
      'evaluationRegressions',
    ])
      expect(await db.query().selectFrom(table).selectAll().execute()).toEqual(
        [],
      );
  });

  it('applies native record and field policies to attached report reads and credential writes', async () => {
    const { service, save } = await setup();
    const { receipt } = await save(await report());
    await expect(
      service.withPolicies({}).getReport(receipt.receiptId),
    ).rejects.toThrow();
    const scoped = service.withPolicies({
      evaluationReports: {
        read: {
          scope: buildFilter((f) => f.string('id').eq('another-report')),
          fields: [
            'id',
            'document',
            'manifest',
            'bundleSha256',
            'bundleFileId',
            'receivedAt',
          ],
        },
      },
    });
    await expect(scoped.getReport(receipt.receiptId)).rejects.toThrow(
      'Record not found.',
    );
    const hiddenDocument = service.withPolicies({
      evaluationReports: { read: { scope: true, fields: ['id'] } },
    });
    await expect(hiddenDocument.getReport(receipt.receiptId)).rejects.toThrow(
      'outside the permitted field scope',
    );
    const readOnly = service.withPolicies({
      evaluationSources: { read: true },
    });
    expect(await readOnly.listSources()).toHaveLength(1);
    await expect(readOnly.disableSource(source.id, 'admin')).rejects.toThrow();
    expect(await service.authenticate('integration-secret')).not.toBeNull();
  });

  it('accepts compatible batch metadata without producing problems or a batch dashboard', async () => {
    const { service, save, db } = await setup();
    const document = batch();
    const { receipt } = await save(document);
    expect(receipt.batchKey).toBe(
      'owner/factory/batches/nb3-daily-smoke-20260925',
    );
    expect(receipt.runKey).toBeUndefined();
    expect((await service.getReport(receipt.receiptId)).document).toEqual(
      document,
    );
    expect(
      await db
        .query()
        .selectFrom('issues')
        .selectAll()
        .where('type', '=', 'automation')
        .execute(),
    ).toEqual([]);
  });

  it('reverses the migration against a real database', async () => {
    const { db, context } = await setup();
    await migration.down!(context);
    await expect(
      db.query().selectFrom('evaluationReports').selectAll().execute(),
    ).rejects.toThrow();
    await migration.up(context);
    expect(
      await db.query().selectFrom('evaluationReports').selectAll().execute(),
    ).toEqual([]);
  });
});

describe('evaluation HTTP boundary', () => {
  it('rejects changed problem payloads and missing evidence references', async () => {
    const { service } = await setup(),
      app = await router(service),
      p = packet(report());
    expect((await app.fetch(linkedRequest(p))).status).toBe(201);
    const problems = submittedProblems(p.document);
    problems[0].title = 'Changed payload';
    expect(
      (await app.fetch(linkedRequest(p, 'integration-secret', { problems })))
        .status,
    ).toBe(409);
    problems[0].findingIds = ['unknown/finding'];
    expect(
      (await app.fetch(linkedRequest(p, 'integration-secret', { problems })))
        .status,
    ).toBe(400);
  });

  it('rejects retired ZIP uploads with a clear format error', async () => {
    const { service } = await setup(),
      app = await router(service);
    const body = new FormData();
    body.set(
      'bundle',
      new Blob(['zip'], { type: 'application/zip' }),
      'report.zip',
    );
    const response = await app.request('/evaluations/import', {
      method: 'POST',
      body,
      headers: { 'x-api-key': 'integration-secret' },
    });
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
  });

  it('limits credential management to permitted users without leaking middleware to other paths', async () => {
    const { service } = await setup(),
      app = await router(service),
      p = packet(await report());
    expect((await app.fetch(linkedRequest(p, 'wrong'))).status).toBe(401);
    expect((await app.request('/evaluations/sources')).status).toBe(401);
    for (const user of ['member', 'reader']) {
      expect(
        (
          await app.request('/evaluations/sources', {
            headers: { 'x-user': user },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await app.request('/evaluations/sources/integration', {
            method: 'DELETE',
            headers: { 'x-user': user },
          })
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await app.request('/evaluations/sources', {
          headers: { 'x-user': 'admin' },
        })
      ).status,
    ).toBe(200);
    const unrelated = new Hono();
    unrelated.route('/', app);
    unrelated.get('/public', (c) => c.text('ok'));
    expect((await unrelated.request('/public')).status).toBe(200);
  });

  it('does not expose removed evaluation, review, comparison or standalone archive APIs', async () => {
    const { service } = await setup(),
      app = await router(service);
    for (const path of [
      'capabilities',
      'reports',
      'reports/report-id',
      'reports/report-id/file',
      'reports/report-id/history',
      'reports/report-id/findings',
      'reports/report-id/samples',
      'modules',
      'options',
      'mappings',
      'findings/finding-id',
      'regressions',
      'compare',
    ]) {
      for (const method of ['GET', 'POST', 'PATCH'])
        expect(
          (
            await app.request('/evaluations/' + path, {
              method,
              headers: { 'x-user': 'admin' },
            })
          ).status,
        ).toBe(404);
    }
  });
});

it('uses producer chronology rather than revision numbers when choosing the current report', async () => {
  const left = await report(),
    right = structuredClone(left);
  right.revision = 99;
  right.precedence.review!.at = '2020-01-01T00:00:00Z';
  expect(precedenceRank(left) > precedenceRank(right)).toBe(true);
});

function linkedRequest(
  p: ReturnType<typeof packet>,
  token = 'integration-secret',
  patch: Record<string, unknown> = {},
  headerPatch: Record<string, string> = {},
) {
  const document = p.document;
  const archive =
    document.type === 'evaluation-report'
      ? document.links.find((link) => link.rel === 'report-archive')
      : undefined;
  const [owner, repo] = document.source.instance.split('/');
  const reportUrl = archive?.path
    ? 'https://' + owner + '.github.io/' + repo + '/' + archive.path
    : null;
  const body = JSON.stringify({
    version: 1,
    document,
    reportUrl,
    problems: submittedProblems(document),
    ...patch,
  });
  return new Request('http://local/evaluations/import', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': token,
      'X-Evaluation-Schema-Version': '1',
      'X-Evaluation-Type': document.type,
      'X-Evaluation-Bundle-SHA256': p.headers.sha256,
      'X-Evaluation-Payload-SHA256': hash(body),
      'Idempotency-Key': p.headers.idempotencyKey,
      ...headerPatch,
    },
    body,
  });
}

describe('linked report delivery', () => {
  it('validates consumed metadata while preserving opaque producer details', async () => {
    const d = report();
    d.scores = { futureRubric: { data: ['owned by the producer'] } };
    expect(validateDocument(d)).toBe(d);
    const input = await linkedInput(packet(d));
    expect(input.document).toEqual(d);
    for (const document of [
      { ...d, schemaVersion: 2 },
      { ...d, revision: 0 },
      { ...d, source: { ...d.source, instance: 'bad/repo/extra' } },
      { ...d, run: { ...d.run, key: 'invalid\nkey' } },
      { ...d, precedence: { ...d.precedence, reviewState: 'invented' } },
      {
        ...d,
        precedence: {
          ...d.precedence,
          producer: {
            ...d.precedence.producer,
            runId: Number.MAX_SAFE_INTEGER + 1,
          },
        },
      },
      { ...d, reviews: [{ findings: [{ id: 5 }] }] },
      { ...d, qa: { criteria: null } },
    ])
      expect(() => validateDocument(document)).toThrow();
  });

  it('rejects missing identities, mismatched headers, malformed and oversized JSON', async () => {
    const { service, db } = await setup(),
      app = await router(service),
      p = packet(report());
    for (const headers of [
      { 'Idempotency-Key': 'wrong' },
      { 'X-Evaluation-Schema-Version': '2' },
      { 'X-Evaluation-Type': 'evaluation-batch' },
      { 'X-Evaluation-Bundle-SHA256': 'bad' },
    ])
      expect(
        (await app.fetch(linkedRequest(p, 'integration-secret', {}, headers)))
          .status,
      ).toBe(400);
    expect(
      (
        await app.fetch(
          linkedRequest(
            p,
            'integration-secret',
            {},
            { authorization: 'Bearer integration-secret' },
          ),
        )
      ).status,
    ).toBe(401);
    for (const [body, status] of [
      ['{invalid', 400],
      ['x'.repeat(4 * 1024 ** 2 + 1), 413],
    ] as const) {
      const original = linkedRequest(p);
      expect(
        (
          await app.request('/evaluations/import', {
            method: 'POST',
            headers: original.headers,
            body,
          })
        ).status,
      ).toBe(status);
    }
    for (const patch of [
      { problems: null },
      { unexpected: true },
      { document: { type: 'evaluation-report' } },
    ]) {
      expect(
        (await app.fetch(linkedRequest(p, 'integration-secret', patch))).status,
      ).toBeGreaterThanOrEqual(400);
    }
    expect(
      await db.query().selectFrom('evaluationReports').selectAll().execute(),
    ).toEqual([]);
  });

  it('rejects unsafe report paths and duplicate or invalid problem references', async () => {
    const { service } = await setup(),
      app = await router(service),
      d = report();
    for (const path of [
      'reports/../outside.html',
      'reports/%2e%2e/out.html',
      'reports/file.html?query',
      'https://other.test/file',
    ]) {
      const changed = structuredClone(d);
      changed.links[0].path = path;
      expect((await app.fetch(linkedRequest(packet(changed)))).status).toBe(
        400,
      );
    }
    const problems = submittedProblems(d);
    for (const invalid of [
      [...problems, ...problems],
      [{ ...problems[0], key: 'bad' }],
      [{ ...problems[0], findingIds: [], qaCriterionId: 'missing' }],
    ])
      expect(
        (
          await app.fetch(
            linkedRequest(packet(d), 'integration-secret', {
              problems: invalid,
            }),
          )
        ).status,
      ).toBe(400);
    expect(
      (
        await app.fetch(
          linkedRequest(packet(batch()), 'integration-secret', { problems }),
        )
      ).status,
    ).toBe(400);
  });

  it('stores JSON metadata and problems with one receipt and no uploaded file', async () => {
    const { service, db } = await setup();
    const app = await router(service),
      p = packet(await report());
    const first = await app.fetch(linkedRequest(p));
    expect(first.status).toBe(201);
    const receipt = (await first.json()) as { receiptId: string };
    const repeat = await app.fetch(linkedRequest(p));
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toEqual(receipt);
    expect(
      await db
        .query()
        .selectFrom('evaluationBundleFiles')
        .selectAll()
        .execute(),
    ).toEqual([]);
    const saved = await service.getReport(receipt.receiptId);
    expect(saved.bundleFileId).toBeNull();
    expect(saved.files).toEqual(['evaluation.json']);
    expect(saved.reportUrl).toBe(
      'https://owner.github.io/factory/reports/issues/146/runs/100/attempt-1/index.html',
    );
    const problems = await createTestProgressService(db).listProblems({
      type: 'automation',
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].factorySource).toMatchObject({
      reportUrl: saved.reportUrl,
      hasArchive: false,
      files: ['evaluation.json'],
    });
    expect(
      JSON.parse(
        (
          await service.attachment(receipt.receiptId, 'evaluation.json')
        ).bytes.toString(),
      ),
    ).toEqual(p.document);
    await expect(
      service.attachment(receipt.receiptId, 'bundle.zip'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      (await app.request('/evaluations/reports/' + receipt.receiptId)).status,
    ).toBe(404);
    expect(
      (
        await app.request('/evaluations/reports/' + receipt.receiptId, {
          headers: { 'x-user': 'member' },
        })
      ).status,
    ).toBe(404);
    const changed = structuredClone(p.document);
    changed.createdAt = '2026-09-25T11:00:00Z';
    expect(
      (
        await app.fetch(
          linkedRequest(p, 'integration-secret', { document: changed }),
        )
      ).status,
    ).toBe(409);
  });

  it('replays historical archives through link delivery without losing files or changing receipts', async () => {
    const { service, db, legacy } = await setup(),
      app = await router(service);
    const { p, bytes, receipt } = await legacy(report());
    for (let retry = 0; retry < 2; retry++) {
      const response = await app.fetch(linkedRequest(p));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(receipt);
    }
    expect(
      await createTestProgressService(db).listProblems({ type: 'automation' }),
    ).toHaveLength(1);
    expect(
      (await service.attachment(receipt.receiptId, 'bundle.zip')).bytes,
    ).toEqual(bytes);
    expect(
      (
        await service.attachment(receipt.receiptId, 'report.html')
      ).bytes.toString(),
    ).toContain('Original archived report');
    expect((await service.getReport(receipt.receiptId)).reportUrl).toBeTruthy();
  });

  it('rejects invalid credentials, unbound sources, altered payloads and unrelated report URLs', async () => {
    const { service, db } = await setup(),
      app = await router(service),
      p = packet(await report());
    expect((await app.fetch(linkedRequest(p, ''))).status).toBe(401);
    expect((await app.fetch(linkedRequest(p, 'wrong'))).status).toBe(401);
    for (const reportUrl of [
      'javascript:alert(1)',
      'https://other.example/report',
      'https://user:secret@owner.github.io/factory/report',
      null,
    ]) {
      expect(
        (await app.fetch(linkedRequest(p, 'integration-secret', { reportUrl })))
          .status,
      ).toBe(400);
    }
    expect(
      (
        await app.fetch(
          linkedRequest(
            p,
            'integration-secret',
            {},
            { 'X-Evaluation-Payload-SHA256': '0'.repeat(64) },
          ),
        )
      ).status,
    ).toBe(400);
    const other = structuredClone(p.document);
    other.source.project = 'owner/another';
    expect((await app.fetch(linkedRequest(packet(other)))).status).toBe(403);
    expect(
      await db.query().selectFrom('evaluationReports').selectAll().execute(),
    ).toHaveLength(0);
  });

  it('retains batch metadata without inventing a batch HTML link', async () => {
    const { service } = await setup(),
      app = await router(service);
    const p = packet(batch());
    expect((await app.fetch(linkedRequest(p))).status).toBe(201);
  });

  it('migrates existing archives reversibly and refuses to discard link-only records', async () => {
    const { service, context, db, legacy } = await setup();
    const d = await report();
    await legacy(d);
    await linkMigration.down!(context);
    await linkMigration.up(context);
    expect(
      await db
        .query()
        .selectFrom('evaluationReports')
        .select('reportUrl')
        .execute(),
    ).toHaveLength(1);
    const linked = structuredClone(d);
    linked.revision += 1;
    expect(
      (await (await router(service)).fetch(linkedRequest(packet(linked))))
        .status,
    ).toBe(201);
    await expect(linkMigration.down!(context)).rejects.toThrow(
      'Archive linked reports',
    );
  });
});

describe('retiring automatic evaluation permissions', () => {
  it('removes only retired grants, preserves manager access and custom roles, and is idempotent', async () => {
    const { db } = await setup();
    await db.builder().createCollection('authorizationPermissionSets', (c) => {
      c.string('id', { primaryKey: true });
      c.string('key');
      c.text('title');
      c.text('grants');
      c.datetime('createdAt');
      c.datetime('updatedAt');
    });
    await db
      .builder()
      .createCollection('authorizationPermissionSetAssignments', (c) => {
        c.string('id', { primaryKey: true });
        c.string('permissionSetKey');
      });
    const context = { query: db.query() } as Parameters<
      typeof originalPermissionSeed.run
    >[0];
    await originalPermissionSeed.run(context);
    const readRole = await db
      .query()
      .selectFrom('authorizationPermissionSets')
      .selectAll()
      .where('key', '=', 'evaluation-reader')
      .executeTakeFirstOrThrow();
    const customGrant = {
      resource: { type: 'page', id: 'testProgressProblems' },
      actions: [{ action: 'access' }],
    };
    await db
      .query()
      .insertInto('authorizationPermissionSets')
      .values({
        id: 'custom',
        key: 'custom',
        title: 'My role',
        grants: JSON.stringify([
          ...JSON.parse(String(readRole.grants)),
          customGrant,
        ]),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute();
    await db
      .query()
      .insertInto('authorizationPermissionSetAssignments')
      .values([
        { id: 'old-assignment', permissionSetKey: 'evaluation-reader' },
        { id: 'manager-assignment', permissionSetKey: 'evaluation-manager' },
        { id: 'custom-assignment', permissionSetKey: 'custom' },
      ])
      .execute();
    await retirePermissionSeed.run(context);
    const rows = await db
      .query()
      .selectFrom('authorizationPermissionSets')
      .selectAll()
      .orderBy('key')
      .execute();
    expect(rows.map((row) => row.key)).toEqual([
      'custom',
      'evaluation-manager',
    ]);
    expect(JSON.parse(String(rows[0].grants))).toEqual([customGrant]);
    expect(rows[0].title).toBe('My role');
    const manager = JSON.parse(String(rows[1].grants));
    expect(manager).toHaveLength(1);
    expect(
      manager[0].actions.map((action: { action: string }) => action.action),
    ).toEqual(['manage']);
    expect(
      (
        await db
          .query()
          .selectFrom('authorizationPermissionSetAssignments')
          .select('id')
          .orderBy('id')
          .execute()
      ).map((row) => row.id),
    ).toEqual(['custom-assignment', 'manager-assignment']);
    await retirePermissionSeed.run(context);
    expect(
      await db
        .query()
        .selectFrom('authorizationPermissionSets')
        .selectAll()
        .orderBy('key')
        .execute(),
    ).toEqual(rows);
  });
});
