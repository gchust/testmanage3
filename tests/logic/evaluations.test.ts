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
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
import { createTestProgressService } from '../../server/providers/test-progress.js';
import {
  parseProblemSubmission,
  type SubmittedProblem,
} from '../../server/providers/evaluations/problems.js';
import {
  EvaluationService,
  occurrenceId,
  type SourceBinding,
} from '../../server/providers/evaluations/service.js';
import {
  deliveryKey,
  hash,
  readArchive,
  subjectOf,
  validateDocument,
  verifyBundle,
  precedenceRank,
  type EvaluationDocument,
} from '../../server/providers/evaluations/protocol.js';
import type { EvaluationReport } from '../../server/providers/evaluations/contracts/report.js';
import { compareReports } from '../../server/providers/evaluations/comparison.js';
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
async function fixture(name = 'report-completed'): Promise<EvaluationDocument> {
  return validateDocument(
    JSON.parse(
      await readFile(
        new URL('../fixtures/evaluations/' + name + '.json', import.meta.url),
        'utf8',
      ),
    ),
  );
}
async function report(name = 'report-completed'): Promise<EvaluationReport> {
  const d = await fixture(name);
  if (d.type !== 'evaluation-report')
    throw new Error('Expected report fixture');
  return d;
}

/** Explicit producer payload for the fixture; the receiver does not infer these issues. */
function submittedProblems(d: EvaluationDocument): SubmittedProblem[] {
  if (d.type !== 'evaluation-report') return [];
  const finding = d.reviews
    .filter((r) => r.selected)
    .flatMap((r) => r.findings)
    .find((f) => f.localId === 'F2' && f.reviewerStatus === 'open');
  if (finding)
    return [
      {
        key: hash('fixture-finding'),
        title: finding.title,
        description: finding.detail,
        subjectKeys: finding.subjectKeys,
        findingIds: [finding.id],
      },
    ];
  return d.qa.criteria
    .filter((c) => c.finalFull === 'failed')
    .map((c) => ({
      key: hash(c.id),
      title: c.text,
      description: c.text,
      subjectKeys: [],
      findingIds: [],
      qaCriterionId: c.id,
    }));
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
function packet(original: EvaluationDocument, html?: string) {
  const document = structuredClone(original);
  const attachments: Array<{
    path: string;
    data: Buffer;
    role: string;
    mediaType: string;
  }> = [];
  if (document.type === 'evaluation-report')
    for (const e of document.evidence)
      if (e.availability === 'attached' && e.attachment) {
        e.sha256 = hash(png);
        if (!attachments.some((a) => a.path === e.attachment))
          attachments.push({
            path: e.attachment,
            data: png,
            role: 'evidence',
            mediaType: 'image/png',
          });
      }
  if (html)
    attachments.push({
      path: 'report.html',
      data: Buffer.from(html),
      role: 'report-html',
      mediaType: 'text/html',
    });
  const files = [
    {
      path: 'evaluation.json',
      data: Buffer.from(JSON.stringify(document)),
      role: document.type,
      mediaType: 'application/json',
    },
    ...attachments,
  ];
  const manifest = {
    schemaVersion: 1,
    type: 'evaluation-bundle',
    subject: subjectOf(document),
    files: files.map((f) => ({
      path: f.path,
      role: f.role,
      mediaType: f.mediaType,
      size: f.data.length,
      sha256: hash(f.data),
    })),
  };
  const bytes = zip([
    ...files,
    { path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
  ]);
  const headers = {
    version: '1',
    type: document.type,
    sha256: hash(bytes),
    idempotencyKey: deliveryKey(subjectOf(document)),
  };
  return {
    bytes,
    headers,
    document,
    verified: () => verifyBundle(bytes, headers),
  };
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
  const save = async (document: EvaluationDocument) => {
    const p = packet(document);
    return service.importBundle(
      source,
      p.bytes,
      p.verified(),
      submittedProblems(document),
    );
  };
  return { db, service, save, context, root, archive };
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
function request(
  p: ReturnType<typeof packet>,
  credential = 'integration-secret',
  problems?: unknown,
): Request {
  const body = new FormData();
  if (problems !== undefined) body.set('problems', JSON.stringify(problems));
  body.set(
    'bundle',
    new Blob([new Uint8Array(p.bytes)], { type: 'application/zip' }),
    'evaluation-bundle.zip',
  );
  return new Request('http://localhost/evaluations/import', {
    method: 'POST',
    body,
    headers: {
      'x-api-key': credential,
      'X-Evaluation-Schema-Version': p.headers.version,
      'X-Evaluation-Type': p.headers.type,
      'X-Evaluation-Bundle-SHA256': p.headers.sha256,
      'Idempotency-Key': p.headers.idempotencyKey,
    },
  });
}

describe('evaluation protocol', () => {
  it.each([
    'report-completed',
    'report-failed',
    'report-blocked',
    'report-partial-handoff',
    'report-legacy-v1-with-v2',
    'report-late-older',
    'batch-in-progress',
  ])('accepts pinned %s contract', async (name) => {
    expect(packet(await fixture(name)).verified().document.type).toMatch(
      /^evaluation-/,
    );
  });
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
  it('rejects wrong request digest, identity, type and unsupported schema', async () => {
    const p = packet(await report());
    for (const delta of [
      { sha256: 'f'.repeat(64) },
      { idempotencyKey: 'wrong' },
      { version: '2' },
      { type: 'evaluation-batch' },
    ])
      expect(() => verifyBundle(p.bytes, { ...p.headers, ...delta })).toThrow();
  });
  it('rejects unsupported document properties and dangling evidence', async () => {
    const d = await report();
    expect(() => validateDocument({ ...d, invented: true })).toThrow();
    d.reviews[0].findings[0].evidence.push('review/missing');
    expect(() => packet(d).verified()).toThrow();
  });
});

describe('durable evaluation reception', () => {
  it('collects unresolved findings into the ordinary problem list with full reports and source links', async () => {
    const { service, db } = await setup();
    const d = await report();
    const p = packet(d, '<html>Full original report</html>');
    const received = await service.importBundle(
      source,
      p.bytes,
      p.verified(),
      submittedProblems(d),
    );
    const rows = await db
      .query()
      .selectFrom('issues')
      .selectAll()
      .where('type', '=', 'automation')
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: d.reviews[0].findings[1].title,
      featurePointId: null,
      status: 'pending',
      factoryReportId: received.receipt.receiptId,
    });
    const tracker = createTestProgressService(db);
    const problem = await tracker.getProblem(Number(rows[0].id));
    expect(problem.factorySource).toMatchObject({
      issueUrl: 'https://github.com/owner/factory/issues/146',
      pullRequestUrl: 'https://github.com/owner/factory/pull/150',
      reportId: received.receipt.receiptId,
    });
    expect(problem.factorySource?.files).toContain('report.html');
    expect(
      (await tracker.listProblems({ type: 'automation' }))[0].featurePointId,
    ).toBeNull();
    expect(await tracker.listProblemActivities(problem.id)).toEqual([
      expect.objectContaining({ actorName: 'GitHub Actions', kind: 'created' }),
    ]);
    expect(
      (await service.findings(received.receipt.receiptId)).find(
        (f) => f.findingId === d.reviews[0].findings[1].id,
      )?.problemId,
    ).toBe(problem.id);
  });

  it('deduplicates deliveries and reassessments without overwriting human edits', async () => {
    const { save, db, service } = await setup();
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
    d.reviews[0].findings[1].id += '-reassessment';
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
    expect(
      (await service.findings(next.receipt.receiptId)).find(
        (f) => f.findingId === d.reviews[0].findings[1].id,
      )?.problemId,
    ).toBe(original.id);
    expect(first.receipt.receiptId).not.toBe(next.receipt.receiptId);
  });

  it('uses explicit module mappings and leaves ambiguous or absent mappings uncategorized', async () => {
    const { save, db, service } = await setup();
    const d = await report();
    await service.mapSubject(
      {
        sourceInstance: source.sourceInstance,
        subjectKey: d.reviews[0].findings[1].subjectKeys[0],
        featurePointId: 1,
      },
      'admin',
    );
    await save(d);
    const row = await db
      .query()
      .selectFrom('issues')
      .selectAll()
      .where('type', '=', 'automation')
      .executeTakeFirstOrThrow();
    expect(row.featurePointId).toBe(1);
  });

  it('collects final failed QA checks without inventing problems for unknown or repaired checks', async () => {
    const { save, db } = await setup();
    const d = await report();
    d.reviews[0].findings = [];
    d.qa.criteria[0].finalFull = 'failed';
    d.qa.criteria[1].finalFull = 'unknown';
    d.outcome.pullRequest = null;
    await save(d);
    const rows = await db
      .query()
      .selectFrom('issues')
      .selectAll()
      .where('type', '=', 'automation')
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe(d.qa.criteria[0].text);
    expect(
      (await createTestProgressService(db).getProblem(Number(rows[0].id)))
        .factorySource?.pullRequestUrl,
    ).toBeNull();
    await db
      .query()
      .deleteFrom('issues')
      .where('id', '=', Number(rows[0].id))
      .execute();
    await save(d);
    expect(
      await db
        .query()
        .selectFrom('issues')
        .selectAll()
        .where('type', '=', 'automation')
        .execute(),
    ).toHaveLength(0);
  });

  it('does not create problems from superseded reports or non-selected reviews', async () => {
    const { save, db } = await setup();
    const current = await report();
    current.precedence.producer.runId += 10;
    current.reviews[0].selected = false;
    await save(current);
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

  it('keeps one persistent receipt for concurrent retries and rejects same-key changed bytes', async () => {
    const { service, db, archive } = await setup(),
      p = packet(await report());
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.importBundle(source, p.bytes, p.verified()),
      ),
    );
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(results.map((r) => r.receipt.receiptId)).size).toBe(1);
    expect(
      await db
        .query()
        .selectFrom('evaluationBundleFiles')
        .select('id')
        .execute(),
    ).toHaveLength(1);
    const restart = new EvaluationService(db, archive);
    expect(
      (await restart.importBundle(source, p.bytes, p.verified())).receipt,
    ).toEqual(results[0].receipt);
    const changed = packet({
      ...p.document,
      createdAt: '2026-09-25T09:00:00Z',
    });
    await expect(
      service.importBundle(source, changed.bytes, changed.verified()),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(
      hash(
        (await service.attachment(results[0].receipt.receiptId, 'bundle.zip'))
          .bytes,
      ),
    ).toBe(p.headers.sha256);
  });
  it('never lets a larger late revision replace better producer facts', async () => {
    const { service, save } = await setup();
    const best = await save(await report());
    await save(await report('report-late-older'));
    const list = await service.listReports('evaluation-report');
    expect(list.items).toHaveLength(1);
    expect(list.items[0].id).toBe(best.receipt.receiptId);
    expect(
      (await service.history(best.receipt.receiptId))
        .filter((r) => r.current)
        .map((r) => r.revision),
    ).toEqual([1]);
    const bestAgain = await report();
    bestAgain.revision = 3;
    bestAgain.metrics.usage.totals.total = 999;
    await save(bestAgain);
    expect(
      (await service.listReports('evaluation-report')).items[0].tokens?.total,
    ).toBe(999);
  });
  it('preserves source bindings and immediately revokes a disabled owner or integration', async () => {
    const { service, db } = await setup(),
      p = packet(await report());
    await expect(
      service.importBundle(
        { ...source, project: 'other/repo' },
        p.bytes,
        p.verified(),
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
      service.importBundle(source, p.bytes, p.verified()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('preserves manual scores, issue lifecycle, finding dispositions and regression evidence', async () => {
    const { service, save, db } = await setup(),
      d = await report();
    const result = await save(d);
    const fid = occurrenceId(d, d.reviews[0].findings[0].id);
    await service.updateFinding(
      fid,
      { problemId: 1, status: 'confirmed', note: 'Human decision' },
      'admin',
    );
    await service.mapSubject(
      {
        sourceInstance: source.sourceInstance,
        subjectKey: d.reviews[0].modules[0].subjectKeys[0],
        featurePointId: 1,
      },
      'admin',
    );
    d.revision = 2;
    d.reviews[0].findings[0].reviewerStatus = 'resolved';
    await save(d);
    expect(
      (await service.findings(result.receipt.receiptId)).find(
        (f) => f.id === fid,
      ),
    ).toMatchObject({
      problemId: 1,
      status: 'confirmed',
      note: 'Human decision',
    });
    await service.recordRegression(
      {
        problemId: 1,
        reportId: result.receipt.receiptId,
        verdict: 'passed',
        note: 'Verified by human',
        evidenceIds: [d.evidence[0].id],
      },
      'admin',
    );
    expect(
      await db.query().selectFrom('issues').selectAll().executeTakeFirst(),
    ).toMatchObject({ status: 'fixing', owner: 'Human' });
    expect(
      await db
        .query()
        .selectFrom('featurePoints')
        .selectAll()
        .executeTakeFirst(),
    ).toMatchObject({ designScore: 8 });
    expect(await service.regressions(1)).toHaveLength(1);
    await expect(
      service.recordRegression(
        {
          problemId: 1,
          reportId: result.receipt.receiptId,
          verdict: 'passed',
          note: 'No evidence',
          evidenceIds: ['missing'],
        },
        'admin',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('applies native record and field policies to reads and manual review writes', async () => {
    const { service, save } = await setup();
    const first = await save(await report());
    const allowedId = first.receipt.receiptId;
    const scoped = service.withPolicies({
      evaluationReports: {
        read: {
          scope: buildFilter((f) => f.string('id').eq('a-different-report')),
          fields: [
            'id',
            'document',
            'bundleSha256',
            'bundleFileId',
            'receivedAt',
            'manifest',
          ],
        },
      },
    });
    // An explicit deny never falls back to the unrestricted integration service.
    await expect(
      service.withPolicies({}).getReport(allowedId),
    ).rejects.toThrow();
    const limited = service.withPolicies({
      evaluationReports: {
        read: {
          scope: true,
          fields: [
            'id',
            'document',
            'bundleSha256',
            'bundleFileId',
            'receivedAt',
            'manifest',
          ],
        },
      },
      evaluationFindings: {
        read: true,
        update: { scope: true, fields: ['status', 'updatedAt'] },
      },
      evaluationAudit: { read: true, create: true },
    });
    const findings = await limited.findings(allowedId);
    await expect(
      limited.updateFinding(
        String(findings[0].id),
        { note: 'Forbidden field' },
        'admin',
      ),
    ).rejects.toThrow();
    await limited.updateFinding(
      String(findings[0].id),
      { status: 'confirmed' },
      'admin',
    );
    expect((await service.findings(allowedId))[0].status).toBe('confirmed');
    await expect(scoped.getReport(allowedId)).rejects.toThrow(
      'Record not found.',
    );
  });

  it('keeps all planned samples and reports batch subject keys in receipts', async () => {
    const { service, save } = await setup(),
      batch = await fixture('batch-in-progress');
    const result = await save(batch);
    expect(result.receipt.batchKey).toBe(
      'owner/factory/batches/nb3-daily-smoke-20260925',
    );
    expect(result.receipt.runKey).toBeUndefined();
    expect(
      (await service.batchSamples(result.receipt.receiptId)).map(
        (s) => s.reception,
      ),
    ).toEqual(['not-received', 'report-missing', 'not-executed']);
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
  it('creates issues only from an explicit factory submission and binds retries to that payload', async () => {
    const { service, db } = await setup(),
      app = await router(service),
      d = await report(),
      p = packet(d);
    expect((await app.fetch(request(p))).status).toBe(201);
    expect(
      await db
        .query()
        .selectFrom('issues')
        .selectAll()
        .where('type', '=', 'automation')
        .execute(),
    ).toHaveLength(0);
    const submission = { version: 1, problems: submittedProblems(d) };
    expect(parseProblemSubmission(submission, d)).toEqual(submission.problems);
    expect((await app.fetch(request(p, 'wrong', submission))).status).toBe(401);
    expect(
      (await app.fetch(request(p, 'integration-secret', submission))).status,
    ).toBe(200);
    expect(
      (await app.fetch(request(p, 'integration-secret', submission))).status,
    ).toBe(200);
    expect(
      await db
        .query()
        .selectFrom('issues')
        .selectAll()
        .where('type', '=', 'automation')
        .execute(),
    ).toHaveLength(1);
    const invalid = structuredClone(submission);
    invalid.problems[0].findingIds = ['unknown/finding'];
    expect(
      (await app.fetch(request(p, 'integration-secret', invalid))).status,
    ).toBe(400);
    const changed = structuredClone(submission);
    changed.problems[0].title = 'Different issue payload';
    expect(
      (await app.fetch(request(p, 'integration-secret', changed))).status,
    ).toBe(409);
  });
  it('uses real multipart requests and returns unwrapped 201/200/409 receipts', async () => {
    const { service } = await setup(),
      app = await router(service),
      p = packet(await report());
    const first = await app.fetch(request(p));
    expect(first.status).toBe(201);
    const receipt = await first.json();
    expect(receipt).toHaveProperty('receiptId');
    expect(receipt).not.toHaveProperty('data');
    const repeat = await app.fetch(request(p));
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toEqual(receipt);
    const changed = packet({
      ...p.document,
      createdAt: '2026-09-25T11:00:00Z',
    });
    expect((await app.fetch(request(changed))).status).toBe(409);
  });
  it('rejects anonymous, invalid credentials, ordinary users and write attempts by readers', async () => {
    const { service } = await setup(),
      app = await router(service),
      p = packet(await report());
    expect((await app.fetch(request(p, 'wrong'))).status).toBe(401);
    expect((await app.request('/evaluations/reports')).status).toBe(401);
    expect(
      (
        await app.request('/evaluations/reports', {
          headers: { 'x-user': 'member' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request('/evaluations/reports', {
          headers: { 'x-user': 'reader' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request('/evaluations/sources', {
          headers: { 'x-user': 'reader' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request('/evaluations/mappings', {
          method: 'POST',
          headers: { 'x-user': 'reader' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    const unrelated = new Hono();
    unrelated.route('/', app);
    unrelated.get('/public', (c) => c.text('ok'));
    expect((await unrelated.request('/public')).status).toBe(200);
  });
  it('delivers stored HTML as a sandboxed attachment with no active inline script', async () => {
    const { service } = await setup(),
      app = await router(service),
      p = packet(await report(), '<script>alert(document.cookie)</script>');
    const receipt = (await (await app.fetch(request(p))).json()) as {
      receiptId: string;
    };
    const response = await app.request(
      '/evaluations/reports/' + receipt.receiptId + '/file?path=report.html',
      { headers: { 'x-user': 'reader' } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('content-security-policy')).toContain(
      'sandbox',
    );
  });
});

describe('version comparability', () => {
  it('shows unknowns and never compares different rubric versions', async () => {
    const left = await report(),
      right = structuredClone(left);
    expect(compareReports(left, right).reasons).toContain(
      'browser-fixtures:unknown',
    );
    left.baseline.environment.browserFixturesSha256 =
      right.baseline.environment.browserFixturesSha256 = 'a'.repeat(64);
    expect(compareReports(left, right).comparable).toBe(true);
    right.baseline.rubric = { id: 'nb3-framework', version: 1 };
    expect(compareReports(left, right).comparable).toBe(false);
    expect(
      compareReports(left, right)
        .modules.flatMap((m) => m.scores)
        .every((s) => s.delta === null),
    ).toBe(true);
  });
  it('ranks review chronology ahead of revision and treats disappearance as unobserved', async () => {
    const left = await report(),
      right = structuredClone(left);
    right.revision = 99;
    right.precedence.review.at = '2020-01-01T00:00:00Z';
    expect(precedenceRank(left) > precedenceRank(right)).toBe(true);
    right.reviews[0].findings = [];
    const diff = compareReports(left, right);
    expect(diff.findings.notObserved.length).toBeGreaterThan(0);
    expect(diff.findings).not.toHaveProperty('resolved');
  });
});
