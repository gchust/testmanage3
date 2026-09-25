import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { parseLinkedReport } from './report-links.js';
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
  bundleFileId: string | null;
  reportUrl: string | null;
  files: string[];
  receivedAt: string;
}
type VerifiedBundle = ReturnType<typeof verifyBundle>;
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
    bundleFileId:
      typeof row.bundleFileId === 'string' ? row.bundleFileId : null,
    reportUrl: typeof row.reportUrl === 'string' ? row.reportUrl : null,
    files:
      row.bundleFileId == null
        ? ['evaluation.json']
        : (JSON.parse(String(row.manifest)) as EvaluationBundle).files.map(
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
    return this.importReport(
      source,
      { document, manifest, sha256, bytes, reportUrl: null },
      problems,
    );
  }

  async importLinkedReport(
    source: SourceBinding,
    input: ReturnType<typeof parseLinkedReport>,
  ) {
    return this.importReport(
      source,
      { ...input, manifest: null, bytes: null },
      input.problems,
    );
  }

  private async importReport(
    source: SourceBinding,
    input: {
      document: EvaluationDocument;
      manifest: EvaluationBundle | null;
      sha256: string;
      bytes: Buffer | null;
      reportUrl: string | null;
    },
    problems?: SubmittedProblem[],
  ): Promise<{ duplicate: boolean; receipt: EvaluationReceipt }> {
    const { document, manifest, sha256, bytes, reportUrl } = input;
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
      .select(['bundleSha256', 'bundleFileId'])
      .where('idempotencyKey', '=', deliveryKey(subject))
      .executeTakeFirst();
    if (existingBytes && existingBytes.bundleSha256 !== sha256)
      throw new EvaluationError(
        'CONFLICT',
        'This subject revision already contains different bytes.',
      );
    // Native File Repository durably writes its metadata and object before any receipt.
    // A duplicate already owns an archive; only a new revision uploads a new object.
    const bundleFileId =
      !bytes || existingBytes?.bundleFileId
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
            .select([
              'bundleSha256',
              'receipt',
              'document',
              'reportUrl',
              'bundleFileId',
            ])
            .where('idempotencyKey', '=', key)
            .executeTakeFirst();
          if (existing) {
            if (
              existing.bundleSha256 !== sha256 ||
              !isDeepStrictEqual(
                JSON.parse(String(existing.document)),
                document,
              ) ||
              (reportUrl &&
                existing.reportUrl &&
                reportUrl !== existing.reportUrl)
            )
              throw new EvaluationError(
                'CONFLICT',
                'This subject revision already contains different bytes.',
              );
            const receipt = JSON.parse(
              String(existing.receipt),
            ) as EvaluationReceipt;
            const archiveKept = !!bundleFileId && !existing.bundleFileId;
            if (archiveKept || (reportUrl && !existing.reportUrl)) {
              await q
                .updateTable('evaluationReports')
                .set({
                  ...(archiveKept
                    ? { bundleFileId, manifest: JSON.stringify(manifest) }
                    : {}),
                  ...(reportUrl && !existing.reportUrl ? { reportUrl } : {}),
                })
                .where('idempotencyKey', '=', key)
                .execute();
            }
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
              archiveKept,
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
              reportUrl,
              rank,
              document: JSON.stringify(document),
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
          return { duplicate: false, receipt, archiveKept: !!bundleFileId };
        });
        if (!result.archiveKept && bundleFileId)
          await this.archive.discard(bundleFileId);
        return { duplicate: result.duplicate, receipt: result.receipt };
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
  async attachment(id: string, file: string) {
    const report = await this.getReport(id);
    if (!report.bundleFileId) {
      if (file === 'evaluation.json')
        return {
          bytes: Buffer.from(JSON.stringify(report.document)),
          contentType: 'application/json; charset=utf-8',
        };
      return notFound();
    }
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
}
