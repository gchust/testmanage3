import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '@nocobase/db';
import type { EvaluationReport } from './document.js';
import { EvaluationError, type EvaluationDocument } from './protocol.js';

export interface SubmittedProblem {
  key: string;
  title: string;
  description: string;
  subjectKeys: string[];
  findingIds: string[];
  qaCriterionId?: string;
}
export interface FactoryProblemSource {
  reportId: string;
  taskTitle: string;
  issueUrl: string;
  pullRequestUrl: string | null;
  environmentUrl: string | null;
  runUrl: string;
  files: string[];
  reportUrl: string | null;
  hasArchive: boolean;
}

export function factoryProblemSource(
  reportId: string,
  report: EvaluationReport,
  files: string[],
  reportUrl: string | null = null,
  hasArchive = true,
): FactoryProblemSource {
  const repo = report.run.task.repository;
  return {
    reportId,
    reportUrl,
    hasArchive,
    taskTitle: report.run.task.title,
    issueUrl: `https://github.com/${repo}/issues/${report.run.task.issue}`,
    pullRequestUrl: report.outcome.pullRequest
      ? `https://github.com/${repo}/pull/${report.outcome.pullRequest.number}`
      : null,
    // This integration uses nb3-factory's documented preview-host.mjs address rule.
    // An address identifies the PR environment; it is not a deployment health check.
    environmentUrl:
      report.source.instance === 'gchust/nb3-factory' &&
      repo === 'gchust/nb3-factory' &&
      report.outcome.pullRequest &&
      /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(
        process.env.FACTORY_PREVIEW_DOMAIN ?? 'nfvd.net',
      )
        ? 'https://nb3-' +
          report.outcome.pullRequest.number +
          '.' +
          (process.env.FACTORY_PREVIEW_DOMAIN ?? 'nfvd.net') +
          '/main/'
        : null,
    runUrl: `https://github.com/${repo}/actions/runs/${report.precedence.producer.runId}/attempts/${report.precedence.producer.attempt}`,
    files,
  };
}
/** Validate producer input and evidence references; the receiver never evaluates findings. */
export function parseProblemSubmission(
  value: unknown,
  document: EvaluationDocument,
): SubmittedProblem[] {
  const invalid = (): never => {
    throw new EvaluationError(
      'INVALID_INPUT',
      'Invalid factory problem submission.',
    );
  };
  const object = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : invalid();
  const text = (v: unknown, max: number): string =>
    typeof v === 'string' && v.length <= max ? v : invalid();
  const list = (v: unknown, max: number): string[] =>
    Array.isArray(v) && v.length <= 300
      ? v.map((x) => text(x, max))
      : invalid();
  const body = object(value);
  if (
    body.version !== 1 ||
    Object.keys(body).some((k) => !['version', 'problems'].includes(k)) ||
    !Array.isArray(body.problems) ||
    body.problems.length > 1000
  )
    return invalid();
  if (document.type !== 'evaluation-report' && body.problems.length)
    return invalid();
  const findings =
    document.type === 'evaluation-report'
      ? new Set(document.reviews.flatMap((r) => r.findings.map((f) => f.id)))
      : new Set<string>();
  const criteria =
    document.type === 'evaluation-report'
      ? new Set(document.qa.criteria.map((c) => c.id))
      : new Set<string>();
  const keys = new Set<string>();
  return body.problems.map((value) => {
    const v = object(value);
    if (
      Object.keys(v).some(
        (k) =>
          ![
            'key',
            'title',
            'description',
            'subjectKeys',
            'findingIds',
            'qaCriterionId',
          ].includes(k),
      )
    )
      return invalid();
    const key = text(v.key, 64),
      title = text(v.title, 2000),
      description = text(v.description, 100000),
      subjectKeys = list(v.subjectKeys, 300),
      findingIds = list(v.findingIds, 251);
    const qaCriterionId =
      v.qaCriterionId === undefined ? undefined : text(v.qaCriterionId, 300);
    if (
      !/^[a-f0-9]{64}$/.test(key) ||
      keys.has(key) ||
      !title.trim() ||
      !findingIds.every((id) => findings.has(id)) ||
      (qaCriterionId !== undefined && !criteria.has(qaCriterionId)) ||
      (!findingIds.length && qaCriterionId === undefined)
    )
      return invalid();
    keys.add(key);
    return {
      key,
      title,
      description,
      subjectKeys,
      findingIds,
      ...(qaCriterionId === undefined ? {} : { qaCriterionId }),
    };
  });
}

export async function recordProblemSubmission(
  connection: DatabaseConnection,
  reportId: string,
  problems: SubmittedProblem[],
): Promise<void> {
  const sha = createHash('sha256')
    .update(JSON.stringify(problems))
    .digest('hex');
  const q = connection.query;
  const existing = await q
    .selectFrom('evaluationAudit')
    .select('detail')
    .where('action', '=', 'problem.submission')
    .where('target', '=', reportId)
    .executeTakeFirst();
  if (existing) {
    if (
      (JSON.parse(String(existing.detail)) as { sha256?: unknown }).sha256 !==
      sha
    )
      throw new EvaluationError(
        'CONFLICT',
        'This report already has a different problem submission.',
      );
    return;
  }
  await q
    .insertInto('evaluationAudit')
    .values({
      id: randomUUID(),
      actorId: 'GitHub Actions',
      action: 'problem.submission',
      target: reportId,
      detail: JSON.stringify({ sha256: sha, count: problems.length }),
      createdAt: new Date(),
    })
    .execute();
}

/** Runs inside the import transaction: a stored receipt also means collected problems. */
export async function collectFactoryProblems(
  connection: DatabaseConnection,
  report: EvaluationReport,
  reportId: string,
  problems: SubmittedProblem[],
): Promise<void> {
  const q = connection.query;
  const now = new Date();
  for (const candidate of problems) {
    const scopedKey = createHash('sha256')
      .update(
        JSON.stringify([report.source.instance, report.run.key, candidate.key]),
      )
      .digest('hex');
    const existing = await q
      .selectFrom('issues')
      .select(['id', 'factoryReportId'])
      .where('factoryKey', '=', scopedKey)
      .executeTakeFirst();
    let problemId = existing ? Number(existing.id) : undefined;
    const occurrences = candidate.findingIds.map((id) =>
      createHash('sha256')
        .update([report.source.instance, report.run.key, id].join('\n'))
        .digest('hex'),
    );
    const findings = occurrences.length
      ? await q
          .selectFrom('evaluationFindings')
          .select(['id', 'problemId', 'status', 'note', 'reportId'])
          .where('id', 'in', occurrences)
          .execute()
      : [];
    // Compatibility only: these historical rows are no longer created or edited.
    // Preserve a human association (including a link to a subsequently deleted
    // problem). Do not recreate or reassign a dismissed finding on retries.
    const handled = findings.find(
      (f) => f.problemId != null || f.status !== 'new' || f.note,
    );
    if (!problemId && handled) continue;
    if (
      !problemId &&
      (await q
        .selectFrom('evaluationAudit')
        .select('id')
        .where('action', '=', 'problem.collect')
        .where('target', '=', scopedKey)
        .executeTakeFirst())
    )
      continue;
    if (problemId) {
      await q
        .updateTable('issues')
        .set({ factoryReportId: reportId })
        .where('id', '=', problemId)
        .execute();
    } else {
      const result = await q
        .insertInto('issues')
        .values({
          title: candidate.title.slice(0, 200),
          description: candidate.description,
          // Staff classify imported problems through the existing Problems page.
          featurePointId: null,
          type: 'automation',
          status: 'pending',
          owner: null,
          ownerId: null,
          factoryKey: scopedKey,
          factoryReportId: reportId,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      problemId = Number(result.insertId);
      if (!Number.isSafeInteger(problemId) || problemId < 1)
        throw new Error('Problem insert did not return an id.');
      await q
        .insertInto('problemActivities')
        .values({
          problemId,
          actorId: null,
          actorName: 'GitHub Actions',
          kind: 'created',
          fromStatus: null,
          toStatus: 'pending',
          createdAt: now,
        })
        .execute();
      await q
        .insertInto('evaluationAudit')
        .values({
          id: randomUUID(),
          actorId: 'GitHub Actions',
          action: 'problem.collect',
          target: scopedKey,
          detail: JSON.stringify({ problemId, reportId }),
          createdAt: now,
        })
        .execute();
    }
  }
}
