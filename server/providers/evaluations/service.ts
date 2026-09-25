import { randomUUID } from 'node:crypto';
import type { EvaluationArchive } from './archive.js';
import { setTimeout as pause } from 'node:timers/promises';
import type {
  DatabaseManager,
  DatabaseConnection,
  RepositoryPolicy,
  Row,
} from '@nocobase/db';
import type { ApiKeyService } from '@nocobase/app-plugin-api-keys/server';
import type { EvaluationBundle } from './contracts/bundle.js';
import type { EvaluationReceipt } from './contracts/receipt.js';
import type { EvaluationReport } from './contracts/report.js';
import {
  EvaluationError,
  deliveryKey,
  hash,
  precedenceRank,
  readArchive,
  subjectId,
  subjectOf,
  validateDocument,
  verifyBundle,
  type EvaluationDocument,
} from './protocol.js';
import { compareReports } from './comparison.js';
import {
  collectFactoryProblems,
  recordProblemSubmission,
  type SubmittedProblem,
} from './problems.js';

export interface SourceBinding {
  id: string;
  apiKeyId: string;
  sourceInstance: string;
  project: string;
  name: string;
  enabled: boolean;
  createdBy: string;
}
export interface StoredReport {
  id: string;
  document: EvaluationDocument;
  bundleSha256: string;
  bundleFileId: string;
  files: string[];
  receivedAt: string;
}
type VerifiedBundle = ReturnType<typeof verifyBundle>;
export const occurrenceId = (
  document: EvaluationReport,
  findingId: string,
): string =>
  hash([document.source.instance, document.run.key, findingId].join('\n'));
const notFound = (): never => {
  throw new EvaluationError('NOT_FOUND', 'Record not found.');
};
function binding(row: Row): SourceBinding {
  return {
    id: String(row.id),
    apiKeyId: String(row.apiKeyId),
    sourceInstance: String(row.sourceInstance),
    project: String(row.project),
    name: String(row.name),
    enabled: Boolean(row.enabled),
    createdBy: String(row.createdBy),
  };
}
function stored(row: Row): StoredReport {
  if (typeof row.document !== 'string' || typeof row.manifest !== 'string')
    throw new EvaluationError(
      'FORBIDDEN',
      'The report document is outside the permitted field scope.',
    );
  return {
    id: String(row.id),
    document: validateDocument(JSON.parse(String(row.document))),
    bundleSha256: String(row.bundleSha256),
    bundleFileId: String(row.bundleFileId),
    files: (JSON.parse(String(row.manifest)) as EvaluationBundle).files.map(
      (file) => file.path,
    ),
    receivedAt: new Date(String(row.receivedAt)).toISOString(),
  };
}
function retryable(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return (
    !!code &&
    [
      'SQLITE_BUSY',
      'SQLITE_BUSY_SNAPSHOT',
      'SQLITE_CONSTRAINT_PRIMARYKEY',
      'SQLITE_CONSTRAINT_UNIQUE',
      '23505',
      '40001',
      '40P01',
    ].includes(code)
  );
}

export class EvaluationService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly archive: EvaluationArchive,
    private readonly keys?: ApiKeyService,
    private readonly policies?: Readonly<Record<string, RepositoryPolicy>>,
  ) {}

  withPolicies(policies: Readonly<Record<string, RepositoryPolicy>>) {
    return new EvaluationService(
      this.database,
      this.archive,
      this.keys,
      policies,
    );
  }
  private repository(name: string, connection = this.database.connection()) {
    const base = connection.repository<Row>(name);
    const policy = this.policies?.[name];
    return base.withPolicy(
      this.policies
        ? {
            read: policy?.read ?? false,
            create: policy?.create ?? false,
            update: policy?.update ?? false,
            delete: policy?.delete ?? false,
          }
        : { read: true, create: true, update: true, delete: true },
    );
  }
  private async audit(
    connection: DatabaseConnection,
    actorId: string,
    action: string,
    target: string,
    detail: unknown,
  ) {
    await this.repository('evaluationAudit', connection).createOne({
      values: {
        id: randomUUID(),
        actorId,
        action,
        target,
        detail: JSON.stringify(detail),
        createdAt: new Date(),
      },
    });
  }
  async listSources() {
    return (
      await this.repository('evaluationSources').findMany({
        sort: (s) => s.field('createdAt').desc(),
      })
    ).map(binding);
  }
  async createSource(
    input: { name: string; sourceInstance: string; project: string },
    userId: string,
  ) {
    if (!this.keys) throw new Error('Credential service is unavailable.');
    const keys = this.keys;
    return this.database.transaction(async (connection) => {
      const issued = await keys
        .withConnection(connection)
        .create({ userId, name: input.name, expiresIn: 365 * 86400 });
      const record = {
        id: randomUUID(),
        apiKeyId: issued.key.id,
        ...input,
        enabled: true,
        createdBy: userId,
        createdAt: new Date(),
      };
      await this.repository('evaluationSources', connection).createOne({
        values: record,
      });
      await this.audit(connection, userId, 'source.create', record.id, {
        sourceInstance: input.sourceInstance,
        project: input.project,
      });
      return { ...binding(record), token: issued.secret };
    });
  }
  async disableSource(id: string, actorId: string) {
    const source = await this.repository('evaluationSources').findOne({
      filter: { id },
    });
    if (!source) return notFound();
    // The application binding is the final gate, even if provider revocation fails.
    await this.database.transaction(async (c) => {
      await this.repository('evaluationSources', c).updateOne({
        filter: { id },
        values: { enabled: false },
      });
      await this.audit(c, actorId, 'source.disable', id, {});
    });
    await this.keys?.disable(String(source.apiKeyId));
  }
  async authenticate(secret: string): Promise<SourceBinding | null> {
    if (!this.keys || !secret || secret.length > 1024) return null;
    const key = await this.keys.verify(secret);
    if (!key) return null;
    const row = await this.database
      .query()
      .selectFrom('evaluationSources')
      .selectAll()
      .where('apiKeyId', '=', key.id)
      .where('enabled', '=', true)
      .executeTakeFirst();
    if (!row) return null;
    const owner = await this.database
      .query()
      .selectFrom('user')
      .select('id')
      .where('id', '=', String(row.createdBy))
      .where('disabledAt', 'is', null)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return owner ? binding(row) : null;
  }

  async importBundle(
    source: SourceBinding,
    bytes: Buffer,
    verified: VerifiedBundle,
    problems?: SubmittedProblem[],
  ): Promise<{ duplicate: boolean; receipt: EvaluationReceipt }> {
    const { document, manifest, sha256 } = verified;
    const subject = subjectOf(document);
    if (
      source.sourceInstance !== document.source.instance ||
      source.project !== document.source.project
    )
      throw new EvaluationError(
        'FORBIDDEN',
        'Credential is not bound to this source and project.',
      );
    const existingBytes = await this.database
      .query()
      .selectFrom('evaluationReports')
      .select(['bundleSha256'])
      .where('idempotencyKey', '=', deliveryKey(subject))
      .executeTakeFirst();
    if (existingBytes && existingBytes.bundleSha256 !== sha256)
      throw new EvaluationError(
        'CONFLICT',
        'This subject revision already contains different bytes.',
      );
    // Native File Repository durably writes its metadata and object before any receipt.
    // A duplicate already owns an archive; only a new revision uploads a new object.
    const bundleFileId = existingBytes
      ? null
      : await this.archive.store(bytes, sha256);
    const id = randomUUID(),
      rank = precedenceRank(document),
      subjectKey = subjectId(document);
    const receipt: EvaluationReceipt = {
      receiptId: id,
      sourceInstance: subject.sourceInstance,
      revision: subject.revision,
      bundleSha256: sha256,
      state: 'stored',
      ...(subject.type === 'evaluation-report'
        ? { runKey: subject.key }
        : { batchKey: subject.key }),
    };
    const key =
      'nb3-eval-v1-' +
      hash(
        [
          subject.sourceInstance,
          subject.type,
          subject.key,
          subject.revision,
        ].join('\n'),
      );
    // Database uniqueness is the lock. Retrying the whole transaction also covers
    // two workers racing to create a subject; no process-local idempotency cache.
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.database.transaction(async (connection) => {
          const q = connection.query;
          const active = await q
            .selectFrom('evaluationSources')
            .select('id')
            .where('id', '=', source.id)
            .where('enabled', '=', true)
            .executeTakeFirst();
          if (!active)
            throw new EvaluationError(
              'FORBIDDEN',
              'Source credential has been disabled.',
            );
          const existing = await q
            .selectFrom('evaluationReports')
            .select(['bundleSha256', 'receipt'])
            .where('idempotencyKey', '=', key)
            .executeTakeFirst();
          if (existing) {
            if (existing.bundleSha256 !== sha256)
              throw new EvaluationError(
                'CONFLICT',
                'This subject revision already contains different bytes.',
              );
            const receipt = JSON.parse(
              String(existing.receipt),
            ) as EvaluationReceipt;
            if (problems)
              await recordProblemSubmission(
                connection,
                receipt.receiptId,
                problems,
              );
            const current = await q
              .selectFrom('evaluationSubjects')
              .select('currentReportId')
              .where('id', '=', subjectKey)
              .executeTakeFirst();
            if (
              document.type === 'evaluation-report' &&
              problems &&
              current?.currentReportId === receipt.receiptId
            ) {
              await collectFactoryProblems(
                connection,
                document,
                receipt.receiptId,
                problems,
              );
            }
            return {
              duplicate: true,
              receipt,
            };
          }
          const now = new Date();
          await q
            .insertInto('evaluationReports')
            .values({
              id,
              sourceInstance: document.source.instance,
              project: document.source.project,
              type: document.type,
              subjectKey: subject.key,
              revision: document.revision,
              idempotencyKey: key,
              bundleSha256: sha256,
              bundleFileId,
              rank,
              document: verified.files.get('evaluation.json')!.toString('utf8'),
              manifest: JSON.stringify(manifest),
              receipt: JSON.stringify(receipt),
              receivedAt: now,
            })
            .execute();
          const current = await q
            .selectFrom('evaluationSubjects')
            .select(['id', 'rank'])
            .where('id', '=', subjectKey)
            .executeTakeFirst();
          if (!current)
            await q
              .insertInto('evaluationSubjects')
              .values({
                id: subjectKey,
                sourceInstance: document.source.instance,
                type: document.type,
                subjectKey: subject.key,
                currentReportId: id,
                rank,
                updatedAt: now,
              })
              .execute();
          else
            await q
              .updateTable('evaluationSubjects')
              .set({ currentReportId: id, rank, updatedAt: now })
              .where('id', '=', subjectKey)
              .where('rank', '<', rank)
              .execute();
          if (document.type === 'evaluation-report')
            for (const review of document.reviews)
              for (const finding of review.findings) {
                const findingKey = occurrenceId(document, finding.id);
                const exists = await q
                  .selectFrom('evaluationFindings')
                  .select('id')
                  .where('id', '=', findingKey)
                  .executeTakeFirst();
                // Machine revisions never overwrite a human disposition, link or note.
                if (!exists)
                  await q
                    .insertInto('evaluationFindings')
                    .values({
                      id: findingKey,
                      sourceInstance: document.source.instance,
                      runKey: document.run.key,
                      findingId: finding.id,
                      reportId: id,
                      finding: JSON.stringify(finding),
                      status: 'new',
                      createdAt: now,
                      updatedAt: now,
                    })
                    .execute();
              }
          if (
            document.type === 'evaluation-report' &&
            problems &&
            (!current || String(current.rank) < rank)
          ) {
            await collectFactoryProblems(connection, document, id, problems);
          }
          if (problems) await recordProblemSubmission(connection, id, problems);
          await this.audit(connection, source.id, 'report.import', id, {
            bundleSha256: sha256,
            revision: document.revision,
          });
          return { duplicate: false, receipt };
        });
        if (result.duplicate && bundleFileId)
          await this.archive.discard(bundleFileId);
        return result;
      } catch (error) {
        if (attempt >= 5 || !retryable(error)) throw error;
        await pause(30 * (attempt + 1));
      }
    }
  }

  async getReport(id: string): Promise<StoredReport> {
    const row = await this.repository('evaluationReports').findOne({
      filter: { id },
    });
    return row ? stored(row) : notFound();
  }
  private async currentRows(type: string, offset = 0, limit = 50) {
    const subjects = await this.repository('evaluationSubjects').findMany({
      filter: { type },
      sort: (s) => s.field('updatedAt').desc(),
      limit: limit + 1,
      offset,
    });
    const ids = subjects.map((s) => String(s.currentReportId));
    if (!ids.length) return [];
    const reports = await this.repository('evaluationReports').findMany({
      filter: (f) => f.or(ids.map((id) => f.string('id').eq(id))),
    });
    return subjects.flatMap((s) => {
      const report = reports.find((r) => r.id === s.currentReportId);
      return report ? [report] : [];
    });
  }
  async listReports(type: string, offset = 0, limit = 50) {
    const rows = await this.currentRows(type, offset, limit);
    return {
      items: rows.slice(0, limit).map((row) => {
        const report = stored(row),
          d = report.document;
        return {
          id: report.id,
          sourceInstance: d.source.instance,
          subjectKey: subjectOf(d).key,
          revision: d.revision,
          createdAt: d.createdAt,
          receivedAt: report.receivedAt,
          title:
            d.type === 'evaluation-report' ? d.run.task.title : d.batch.key,
          outcome:
            d.type === 'evaluation-report'
              ? d.outcome
              : { execution: d.state, acceptance: null, delivery: null },
          tokens:
            d.type === 'evaluation-report' ? d.metrics.usage.totals : null,
          review:
            d.type === 'evaluation-report' ? d.precedence.reviewState : null,
          baseline: d.baseline,
        };
      }),
      hasMore: rows.length > limit,
    };
  }
  async history(id: string) {
    const { document } = await this.getReport(id),
      subject = subjectOf(document);
    const rows = await this.repository('evaluationReports').findMany({
      filter: {
        sourceInstance: subject.sourceInstance,
        type: subject.type,
        subjectKey: subject.key,
      },
      sort: (s) => s.field('revision').desc(),
      select: (s) =>
        s.fields('id', 'revision', 'rank', 'receivedAt', 'bundleSha256'),
    });
    const current = await this.repository('evaluationSubjects').findOne({
      filter: { id: subjectId(document) },
    });
    return rows.map((row) => ({
      ...row,
      current: row.id === current?.currentReportId,
    }));
  }
  async attachment(id: string, file: string) {
    const report = await this.getReport(id);
    const bytes = await this.archive.read(report.bundleFileId);
    if (hash(bytes) !== report.bundleSha256)
      throw new Error('Stored archive checksum mismatch.');
    if (file === 'bundle.zip') return { bytes, contentType: 'application/zip' };
    const files = readArchive(bytes),
      data = files.get(file);
    if (!data) return notFound();
    return {
      bytes: data,
      contentType: file.endsWith('.png')
        ? 'image/png'
        : file.endsWith('.html')
          ? 'text/html; charset=utf-8'
          : 'application/json; charset=utf-8',
    };
  }
  async findings(id: string) {
    const { document } = await this.getReport(id);
    if (document.type !== 'evaluation-report') return [];
    const ids = document.reviews.flatMap((r) =>
      r.findings.map((f) => occurrenceId(document, f.id)),
    );
    if (!ids.length) return [];
    return this.repository('evaluationFindings').findMany({
      filter: (f) => f.or(ids.map((id) => f.string('id').eq(id))),
      select: (s) =>
        s.fields(
          'id',
          'findingId',
          'reportId',
          'problemId',
          'status',
          'note',
          'updatedAt',
        ),
    });
  }
  async trackerOptions() {
    return {
      features: await this.repository('featurePoints').findMany({
        filter: { level: 'feature' },
        select: (s) => s.fields('id', 'name', 'level'),
      }),
      problems: await this.repository('issues').findMany({
        select: (s) => s.fields('id', 'title'),
      }),
    };
  }
  async mappings() {
    return this.repository('evaluationMappings').findMany({
      sort: (s) => s.field('subjectKey').asc(),
    });
  }
  async modules(offset = 0) {
    const reports = await this.currentRows('evaluation-report', offset);
    const mappings = await this.mappings();
    const items = reports.slice(0, 50).flatMap((row) => {
      const document = validateDocument(JSON.parse(String(row.document)));
      if (document.type !== 'evaluation-report') return [];
      return document.reviews
        .filter((r) => r.selected)
        .flatMap((r) =>
          r.modules.map((m) => ({
            reportId: String(row.id),
            sourceInstance: document.source.instance,
            key: m.key,
            name: m.name,
            subjectKeys: m.subjectKeys,
            mapped: mappings.filter(
              (v) =>
                v.sourceInstance === document.source.instance &&
                m.subjectKeys.includes(String(v.subjectKey)),
            ),
          })),
        );
    });
    return { items, hasMore: reports.length > 50 };
  }
  async compare(leftId: string, rightId: string) {
    const left = await this.getReport(leftId),
      right = await this.getReport(rightId);
    const result = compareReports(left.document, right.document);
    const fingerprints: Array<string | null> = [];
    for (const document of [left.document, right.document]) {
      if (
        document.type !== 'evaluation-report' ||
        document.run.kind !== 'batch-sample'
      )
        continue;
      const subject =
        document.source.instance + '/batches/' + document.run.batchKey;
      const current = await this.repository('evaluationSubjects').findOne({
        filter: {
          sourceInstance: document.source.instance,
          type: 'evaluation-batch',
          subjectKey: subject,
        },
      });
      const row = current
        ? await this.repository('evaluationReports').findOne({
            filter: { id: String(current.currentReportId) },
          })
        : null;
      const batch = row
        ? validateDocument(JSON.parse(String(row.document)))
        : null;
      const sample =
        batch?.type === 'evaluation-batch'
          ? batch.samples.find(
              (s) =>
                s.key === document.run.sampleKey &&
                s.runKey === document.run.key,
            )
          : null;
      fingerprints.push(
        batch?.type === 'evaluation-batch'
          ? (batch.baseline.agentConfig?.fingerprint ?? null)
          : null,
      );
      if (
        !sample ||
        sample.comparable !== true ||
        batch?.type !== 'evaluation-batch' ||
        sample.agentConfigFingerprint !==
          batch.baseline.agentConfig?.fingerprint
      )
        result.reasons.push('batch-comparability:unknown-or-drifted');
    }
    if (
      fingerprints.length &&
      (fingerprints.length !== 2 ||
        !fingerprints[0] ||
        fingerprints[0] !== fingerprints[1])
    )
      result.reasons.push('batch-agent-config:unknown-or-different');
    if (result.reasons.length) {
      result.comparable = false;
      for (const m of result.modules) for (const s of m.scores) s.delta = null;
    }
    return result;
  }
  async mapSubject(
    input: {
      sourceInstance: string;
      subjectKey: string;
      featurePointId: number;
    },
    actorId: string,
  ) {
    const feature = await this.repository('featurePoints').findOne({
      filter: { id: input.featurePointId, level: 'feature' },
    });
    if (!feature) return notFound();
    const id = hash(input.sourceInstance + '\n' + input.subjectKey);
    return this.database.transaction(async (c) => {
      const repository = this.repository('evaluationMappings', c);
      const existing = await repository.findOne({ filter: { id } });
      const record = { ...input, updatedBy: actorId, updatedAt: new Date() };
      if (existing)
        await repository.updateOne({ filter: { id }, values: record });
      else await repository.createOne({ values: { id, ...record } });
      await this.audit(c, actorId, 'subject.map', id, record);
      return { id, ...record };
    });
  }
  async updateFinding(
    id: string,
    input: { problemId?: number | null; status?: string; note?: string },
    actorId: string,
  ) {
    return this.database.transaction(async (c) => {
      const repository = this.repository('evaluationFindings', c);
      if (!(await repository.findOne({ filter: { id } }))) return notFound();
      if (
        input.problemId != null &&
        !(await this.repository('issues', c).findOne({
          filter: { id: input.problemId },
        }))
      )
        return notFound();
      const updated = await repository.updateOne({
        filter: { id },
        values: { ...input, updatedAt: new Date() },
      });
      await this.audit(c, actorId, 'finding.review', id, input);
      return updated.record;
    });
  }
  async regressions(problemId?: number) {
    return this.repository('evaluationRegressions').findMany({
      ...(problemId === undefined ? {} : { filter: { problemId } }),
      sort: (s) => s.field('createdAt').desc(),
      limit: 200,
    });
  }
  async recordRegression(
    input: {
      problemId: number;
      reportId: string;
      verdict: string;
      evidenceIds: string[];
      note: string;
    },
    actorId: string,
  ) {
    const { document } = await this.getReport(input.reportId);
    if (
      document.type !== 'evaluation-report' ||
      !input.evidenceIds.every((id) =>
        document.evidence.some((e) => e.id === id),
      )
    )
      throw new EvaluationError(
        'INVALID_INPUT',
        'Regression evidence must belong to the selected report.',
      );
    return this.database.transaction(async (c) => {
      if (
        !(await this.repository('issues', c).findOne({
          filter: { id: input.problemId },
        }))
      )
        return notFound();
      const record = {
        ...input,
        id: randomUUID(),
        evidenceIds: JSON.stringify(input.evidenceIds),
        createdBy: actorId,
        createdAt: new Date(),
      };
      await this.repository('evaluationRegressions', c).createOne({
        values: record,
      });
      await this.audit(c, actorId, 'regression.record', record.id, input);
      return record;
    });
  }
  async batchSamples(id: string) {
    const { document } = await this.getReport(id);
    if (document.type !== 'evaluation-batch')
      throw new EvaluationError('INVALID_INPUT', 'Expected a batch.');
    // Use the exact revision named by the coordinator, never a stale attempt or
    // an arbitrary current run. Every planned sample remains in the result.
    const keys = document.samples.map((s) => s.runKey);
    const rows = keys.length
      ? await this.repository('evaluationReports').findMany({
          filter: (f) =>
            f.and([
              f.string('sourceInstance').eq(document.source.instance),
              f.string('type').eq('evaluation-report'),
              f.or(keys.map((key) => f.string('subjectKey').eq(key))),
            ]),
          select: (s) => s.fields('id', 'subjectKey', 'revision'),
        })
      : [];
    return document.samples.map((sample) => {
      const local =
        sample.report.state === 'available'
          ? rows.find(
              (r) =>
                r.subjectKey === sample.runKey &&
                r.revision === sample.report.revision,
            )
          : undefined;
      return {
        ...sample,
        localReportId: local?.id ?? null,
        reception: local
          ? 'stored'
          : sample.report.state === 'not-applicable'
            ? 'not-applicable'
            : sample.state === 'planned'
              ? 'not-executed'
              : sample.report.state === 'available'
                ? 'not-received'
                : 'report-missing',
      };
    });
  }
}
