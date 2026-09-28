import { createHash, randomUUID } from 'node:crypto';
import type { FactoryPreviewConfig } from '../../config/factory-preview.js';
import type { DatabaseConnection } from '@nocobase/db';
import type { EvaluationReport } from './document.js';
import {
  inheritFeaturePointOwner,
  type OwnerFields,
} from '../problem-owners.js';
import { EvaluationError, type EvaluationDocument } from './protocol.js';

/** The factory's pre-delivery feature point decision; `null` explains why none fits. */
export interface ProblemClassification {
  featurePointId: number | null;
  method: 'rule' | 'model';
  reason: string;
}
export interface SubmittedProblem {
  key: string;
  title: string;
  description: string;
  subjectKeys: string[];
  findingIds: string[];
  qaCriterionId?: string;
  classification?: ProblemClassification;
}
/** A host name the preview address rule may be applied to. */
const PREVIEW_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

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
  preview: FactoryPreviewConfig | null = null,
): FactoryProblemSource {
  const repo = report.run.task.repository;
  const pullRequest = report.outcome.pullRequest;
  return {
    reportId,
    reportUrl,
    hasArchive,
    taskTitle: report.run.task.title,
    issueUrl: `https://github.com/${repo}/issues/${report.run.task.issue}`,
    pullRequestUrl: pullRequest
      ? `https://github.com/${repo}/pull/${pullRequest.number}`
      : null,
    // The factory's documented preview-host.mjs address rule; see FactoryPreviewConfig.
    environmentUrl:
      preview &&
      preview.repository !== '' &&
      report.source.instance === preview.repository &&
      repo === preview.repository &&
      pullRequest &&
      PREVIEW_DOMAIN.test(preview.domain)
        ? `https://nb3-${pullRequest.number}.${preview.domain}/main/`
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
  const classificationOf = (
    v: Record<string, unknown>,
  ): ProblemClassification => {
    if (
      Object.keys(v).some(
        (k) => !['featurePointId', 'method', 'reason'].includes(k),
      ) ||
      (v.featurePointId !== null &&
        !(
          Number.isSafeInteger(v.featurePointId) && Number(v.featurePointId) > 0
        )) ||
      (v.method !== 'rule' && v.method !== 'model')
    )
      return invalid();
    const reason = text(v.reason, 1000);
    if (!reason.trim()) return invalid();
    return {
      featurePointId: v.featurePointId as number | null,
      method: v.method,
      reason,
    };
  };
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
            'classification',
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
    const classification =
      v.classification === undefined
        ? undefined
        : classificationOf(object(v.classification));
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
      ...(classification === undefined ? {} : { classification }),
    };
  });
}

// A classification is advisory metadata, decided per delivery: retries and replays
// may carry a different one without changing which problems a report submitted.
const identity = (problems: SubmittedProblem[]) =>
  problems.map(({ classification: _classification, ...problem }) => problem);

export async function recordProblemSubmission(
  connection: DatabaseConnection,
  reportId: string,
  problems: SubmittedProblem[],
): Promise<void> {
  const sha = createHash('sha256')
    .update(JSON.stringify(identity(problems)))
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
    const scopedKey = problemKey(report, candidate);
    const existing = await q
      .selectFrom('issues')
      .select([
        'id',
        'factoryReportId',
        'featurePointId',
        'classificationSource',
        'owner',
        'ownerId',
      ])
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
    // Fill only a problem nobody has classified; people and earlier results win.
    const classification =
      !existing ||
      (existing.featurePointId == null && existing.classificationSource == null)
        ? await applicableClassification(connection, candidate.classification)
        : null;
    if (problemId) {
      await q
        .updateTable('issues')
        .set({
          factoryReportId: reportId,
          ...(classification ? classifiedFields(classification, existing) : {}),
        })
        .where('id', '=', problemId)
        .execute();
    } else {
      const result = await q
        .insertInto('issues')
        .values({
          title: candidate.title.slice(0, 200),
          description: candidate.description,
          // Without a factory classification, staff classify it on the Problems page.
          featurePointId: null,
          classificationSource: null,
          classificationNote: null,
          owner: null,
          ownerId: null,
          ...(classification ? classifiedFields(classification) : {}),
          type: 'automation',
          status: 'pending',
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
    if (classification)
      await auditClassification(connection, scopedKey, {
        problemId,
        reportId,
        ...classifiedFields(classification, existing),
      });
  }
}

/**
 * A superseded report collects nothing, but a replay of it may still classify the
 * problems it collected while it was current, under the same fill-only rule.
 */
export async function classifyCollectedProblems(
  connection: DatabaseConnection,
  report: EvaluationReport,
  reportId: string,
  problems: SubmittedProblem[],
): Promise<void> {
  for (const candidate of problems) {
    if (!candidate.classification) continue;
    const scopedKey = problemKey(report, candidate);
    const existing = await connection.query
      .selectFrom('issues')
      .select(['id', 'owner', 'ownerId'])
      .where('factoryKey', '=', scopedKey)
      .where('featurePointId', 'is', null)
      .where('classificationSource', 'is', null)
      .executeTakeFirst();
    const classification =
      existing &&
      (await applicableClassification(connection, candidate.classification));
    if (!existing || !classification) continue;
    const fields = classifiedFields(classification, existing);
    await connection.query
      .updateTable('issues')
      .set(fields)
      .where('id', '=', Number(existing.id))
      .execute();
    await auditClassification(connection, scopedKey, {
      problemId: Number(existing.id),
      reportId,
      ...fields,
    });
  }
}

const problemKey = (report: EvaluationReport, candidate: SubmittedProblem) =>
  createHash('sha256')
    .update(
      JSON.stringify([report.source.instance, report.run.key, candidate.key]),
    )
    .digest('hex');

async function auditClassification(
  connection: DatabaseConnection,
  scopedKey: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await connection.query
    .insertInto('evaluationAudit')
    .values({
      id: randomUUID(),
      actorId: 'GitHub Actions',
      action: 'problem.classify',
      target: scopedKey,
      detail: JSON.stringify(detail),
      createdAt: new Date(),
    })
    .execute();
}

interface ApplicableClassification {
  featurePointId: number | null;
  classificationSource: ProblemClassification['method'];
  classificationNote: string;
  /** The feature point's owner, inherited by a problem that has none. */
  inheritedOwner: OwnerFields | null;
}

/** A feature point the factory named must still exist as a feature; otherwise stay unclassified. */
async function applicableClassification(
  connection: DatabaseConnection,
  classification: ProblemClassification | undefined,
): Promise<ApplicableClassification | null> {
  if (!classification) return null;
  const { featurePointId, method, reason } = classification;
  const point =
    featurePointId === null
      ? null
      : await connection.query
          .selectFrom('featurePoints')
          .select(['owner', 'ownerId'])
          .where('id', '=', featurePointId)
          .where('level', '=', 'feature')
          .executeTakeFirst();
  if (featurePointId !== null && !point) return null;
  return {
    featurePointId,
    classificationSource: method,
    classificationNote: reason,
    inheritedOwner: point
      ? await inheritFeaturePointOwner(connection.query, point)
      : null,
  };
}

/** Columns to write; an existing owner, set by anyone, is never replaced. */
function classifiedFields(
  { inheritedOwner, ...classification }: ApplicableClassification,
  problem?: { owner?: unknown; ownerId?: unknown },
) {
  return {
    ...classification,
    ...(inheritedOwner && !problem?.owner && !problem?.ownerId
      ? inheritedOwner
      : {}),
  };
}
