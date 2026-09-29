import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FactoryPreviewConfig } from '../../config/factory-preview.js';
import type { DatabaseConnection } from '@nocobase/db';
import type { EvaluationReport } from './document.js';
import {
  inheritFeaturePointOwner,
  type OwnerFields,
} from '../problem-owners.js';
import { EvaluationError, type EvaluationDocument } from './protocol.js';
import type { ProblemStatus } from '../test-progress.js';

/** The factory's pre-delivery feature point decision; `null` explains why none fits. */
export interface ProblemClassification {
  featurePointId: number | null;
  method: 'rule' | 'model';
  reason: string;
}
/** The factory model's judgement that a problem is one the task already reported. */
export interface ProblemDuplicate {
  problemId: number;
  reason: string;
}
export interface SubmittedProblem {
  key: string;
  /** The factory task (a preset or an Issue) whose runs share fingerprints. */
  taskKey?: string;
  /** The same problem in another run of the same task; never shared across tasks. */
  fingerprint?: string;
  duplicateOf?: ProblemDuplicate;
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

/**
 * What a problem's source links are built from. It is stored with each report
 * when the report is received (`evaluationReports.problemSource`), so listing
 * problems never reads or validates a report document again. The preview link
 * depends on configuration and is derived on read.
 */
export interface ReportLinkFacts {
  taskTitle: string;
  repository: string;
  issue: number;
  pullRequest: number | null;
  sourceInstance: string;
  runId: number;
  attempt: number;
  files: string[];
  hasArchive: boolean;
}

const reportLinkFactsSchema = z.strictObject({
  taskTitle: z.string(),
  repository: z.string(),
  issue: z.number().int().positive(),
  pullRequest: z.number().int().positive().nullable(),
  sourceInstance: z.string(),
  runId: z.number().int().positive(),
  attempt: z.number().int().positive(),
  files: z.array(z.string()),
  hasArchive: z.boolean(),
});

export function reportLinkFacts(
  report: EvaluationReport,
  files: string[],
  hasArchive: boolean,
): ReportLinkFacts {
  return {
    taskTitle: report.run.task.title,
    repository: report.run.task.repository,
    issue: report.run.task.issue,
    pullRequest: report.outcome.pullRequest?.number ?? null,
    sourceInstance: report.source.instance,
    runId: report.precedence.producer.runId,
    attempt: report.precedence.producer.attempt,
    files,
    hasArchive,
  };
}

/** Reads stored link facts; throws when the stored value is not what was written. */
export function parseReportLinkFacts(value: string): ReportLinkFacts {
  return reportLinkFactsSchema.parse(JSON.parse(value));
}

export function problemSourceFromFacts(
  reportId: string,
  facts: ReportLinkFacts,
  reportUrl: string | null,
  preview: FactoryPreviewConfig | null,
): FactoryProblemSource {
  const repo = facts.repository;
  return {
    reportId,
    reportUrl,
    hasArchive: facts.hasArchive,
    taskTitle: facts.taskTitle,
    issueUrl: `https://github.com/${repo}/issues/${facts.issue}`,
    pullRequestUrl:
      facts.pullRequest === null
        ? null
        : `https://github.com/${repo}/pull/${facts.pullRequest}`,
    // The factory's documented preview-host.mjs address rule; see FactoryPreviewConfig.
    environmentUrl:
      preview &&
      preview.repository !== '' &&
      facts.sourceInstance === preview.repository &&
      repo === preview.repository &&
      facts.pullRequest !== null &&
      PREVIEW_DOMAIN.test(preview.domain)
        ? `https://nb3-${facts.pullRequest}.${preview.domain}/main/`
        : null,
    runUrl: `https://github.com/${repo}/actions/runs/${facts.runId}/attempts/${facts.attempt}`,
    files: facts.files,
  };
}

export function factoryProblemSource(
  reportId: string,
  report: EvaluationReport,
  files: string[],
  reportUrl: string | null = null,
  hasArchive = true,
  preview: FactoryPreviewConfig | null = null,
): FactoryProblemSource {
  return problemSourceFromFacts(
    reportId,
    reportLinkFacts(report, files, hasArchive),
    reportUrl,
    preview,
  );
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
  const duplicateOfValue = (v: Record<string, unknown>): ProblemDuplicate => {
    if (
      Object.keys(v).some((k) => !['problemId', 'reason'].includes(k)) ||
      !(Number.isSafeInteger(v.problemId) && Number(v.problemId) > 0)
    )
      return invalid();
    const reason = text(v.reason, 1000);
    if (!reason.trim()) return invalid();
    return { problemId: v.problemId as number, reason };
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
            'taskKey',
            'fingerprint',
            'duplicateOf',
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
    const taskKey = v.taskKey === undefined ? undefined : text(v.taskKey, 80);
    const fingerprint =
      v.fingerprint === undefined ? undefined : text(v.fingerprint, 64);
    const duplicateOf =
      v.duplicateOf === undefined
        ? undefined
        : duplicateOfValue(object(v.duplicateOf));
    const qaCriterionId =
      v.qaCriterionId === undefined ? undefined : text(v.qaCriterionId, 300);
    const classification =
      v.classification === undefined
        ? undefined
        : classificationOf(object(v.classification));
    if (
      !/^[a-f0-9]{64}$/.test(key) ||
      (taskKey !== undefined && !TASK_KEY.test(taskKey)) ||
      (fingerprint !== undefined && !/^[a-f0-9]{64}$/.test(fingerprint)) ||
      (duplicateOf !== undefined && taskKey === undefined) ||
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
      ...(taskKey === undefined ? {} : { taskKey }),
      ...(fingerprint === undefined ? {} : { fingerprint }),
      ...(duplicateOf === undefined ? {} : { duplicateOf }),
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
// The task, fingerprint and duplicate judgement only say where a problem merges,
// so a replay of a report delivered before they existed is the same submission.
const identity = (problems: SubmittedProblem[]) =>
  problems.map(
    ({
      classification: _classification,
      taskKey: _taskKey,
      fingerprint: _fingerprint,
      duplicateOf: _duplicateOf,
      ...problem
    }) => problem,
  );

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
    const collectedId = await collectedProblemId(connection, scopedKey);
    let existing =
      collectedId === undefined
        ? undefined
        : await q
            .selectFrom('issues')
            .select(COLLECTED_FIELDS)
            .where('id', '=', collectedId)
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
    // Another run of the same task: record it on the problem it already reported,
    // found by its wording, or by the factory model's judgement within the task.
    const task = taskOf(report, candidate);
    if (!problemId) {
      const recurrence = await recurringProblem(connection, candidate, task);
      if (recurrence) {
        existing = recurrence.problem;
        problemId = Number(existing.id);
        await recordRecurrence(connection, {
          scopedKey,
          fingerprint: candidate.fingerprint ?? null,
          problemId,
          reportId,
          note: recurrence.note,
          now,
        });
      }
    }
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
          // Problems collected before fingerprints existed learn theirs on replay.
          ...(candidate.fingerprint && existing?.factoryFingerprint == null
            ? { factoryFingerprint: candidate.fingerprint }
            : {}),
          ...(task && existing?.factoryTask == null
            ? { factoryTask: task }
            : {}),
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
          factoryFingerprint: candidate.fingerprint ?? null,
          factoryTask: task,
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
    const collectedId = await collectedProblemId(connection, scopedKey);
    if (collectedId === undefined) continue;
    const existing = await connection.query
      .selectFrom('issues')
      .select(['id', 'owner', 'ownerId'])
      .where('id', '=', collectedId)
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

const COLLECTED_FIELDS = [
  'id',
  'factoryReportId',
  'factoryFingerprint',
  'factoryTask',
  'featurePointId',
  'classificationSource',
  'owner',
  'ownerId',
] as const;

/**
 * A recurrence joins the task's open problem, or the one people cancelled, so
 * a dismissed problem stays dismissed. A verified problem that comes back is
 * collected as a new problem: its fix did not hold.
 */
const UNMERGED_STATUSES: readonly ProblemStatus[] = ['verified'];

/** The problem a run's scoped key was collected into: its own, or as a recurrence. */
async function collectedProblemId(
  connection: DatabaseConnection,
  scopedKey: string,
): Promise<number | undefined> {
  const own = await connection.query
    .selectFrom('issues')
    .select('id')
    .where('factoryKey', '=', scopedKey)
    .executeTakeFirst();
  if (own) return Number(own.id);
  const occurrence = await connection.query
    .selectFrom('factoryProblemOccurrences')
    .select('problemId')
    .where('factoryKey', '=', scopedKey)
    .executeTakeFirst();
  return occurrence ? Number(occurrence.problemId) : undefined;
}

const TASK_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/** The task a problem belongs to, scoped to the factory that reported it. */
const taskOf = (report: EvaluationReport, candidate: SubmittedProblem) =>
  candidate.taskKey ? `${report.source.instance}/${candidate.taskKey}` : null;

/**
 * The problem a new run's problem recurs as: the newest mergeable problem with
 * the same fingerprint, its own or learned from an earlier recurrence, and
 * otherwise the task's problem the factory model named, if it is still mergeable
 * and belongs to that task.
 */
async function recurringProblem(
  connection: DatabaseConnection,
  candidate: SubmittedProblem,
  task: string | null,
) {
  const q = connection.query;
  const mergeable = (ids: number[]) =>
    q
      .selectFrom('issues')
      .select(COLLECTED_FIELDS)
      .where('id', 'in', ids)
      .where('status', 'not in', [...UNMERGED_STATUSES])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  if (candidate.fingerprint) {
    const [own, learned] = await Promise.all([
      q
        .selectFrom('issues')
        .select('id')
        .where('factoryFingerprint', '=', candidate.fingerprint)
        .execute(),
      q
        .selectFrom('factoryProblemOccurrences')
        .select('problemId')
        .where('fingerprint', '=', candidate.fingerprint)
        .execute(),
    ]);
    const ids = [
      ...own.map((row) => Number(row.id)),
      ...learned.map((row) => Number(row.problemId)),
    ];
    const problem = ids.length ? await mergeable(ids) : undefined;
    if (problem) return { problem, note: null };
  }
  if (candidate.duplicateOf && task) {
    const problem = await q
      .selectFrom('issues')
      .select(COLLECTED_FIELDS)
      .where('id', '=', candidate.duplicateOf.problemId)
      .where('factoryTask', '=', task)
      .where('status', 'not in', [...UNMERGED_STATUSES])
      .executeTakeFirst();
    if (problem) return { problem, note: candidate.duplicateOf.reason };
  }
  return undefined;
}

/**
 * The later run's key now resolves to the problem, and its audit entry keeps a
 * problem someone deletes from being collected again by this run, as for the first.
 */
async function recordRecurrence(
  connection: DatabaseConnection,
  recurrence: {
    scopedKey: string;
    fingerprint: string | null;
    problemId: number;
    reportId: string;
    note: string | null;
    now: Date;
  },
): Promise<void> {
  const q = connection.query;
  const { scopedKey, fingerprint, problemId, reportId, note, now } = recurrence;
  await q
    .insertInto('factoryProblemOccurrences')
    .values({
      factoryKey: scopedKey,
      fingerprint,
      problemId,
      reportId,
      createdAt: now,
    })
    .execute();
  await q
    .insertInto('problemActivities')
    .values({
      problemId,
      actorId: null,
      actorName: 'GitHub Actions',
      kind: 'recurred',
      fromStatus: null,
      toStatus: null,
      note,
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
      detail: JSON.stringify({
        problemId,
        reportId,
        recurrence: note === null ? 'fingerprint' : 'model',
        ...(note === null ? {} : { reason: note }),
      }),
      createdAt: now,
    })
    .execute();
}

/** Mergeable problems of the requested tasks, for the factory model to compare against. */
export async function listTaskProblems(
  connection: DatabaseConnection,
  sourceInstance: string,
  taskKeys: string[],
): Promise<
  Array<{
    id: number;
    taskKey: string;
    title: string;
    description: string;
    status: string;
    fingerprints: string[];
  }>
> {
  const result = [];
  for (const taskKey of taskKeys) {
    const rows = await connection.query
      .selectFrom('issues')
      .select(['id', 'title', 'description', 'status', 'factoryFingerprint'])
      .where('factoryTask', '=', `${sourceInstance}/${taskKey}`)
      .where('status', 'not in', [...UNMERGED_STATUSES])
      .orderBy('id', 'desc')
      .limit(TASK_PROBLEM_LIMIT)
      .execute();
    const ids = rows.map((row) => Number(row.id));
    const learned = ids.length
      ? await connection.query
          .selectFrom('factoryProblemOccurrences')
          .select(['problemId', 'fingerprint'])
          .where('problemId', 'in', ids)
          .execute()
      : [];
    for (const row of rows) {
      const id = Number(row.id);
      result.push({
        id,
        taskKey,
        title: String(row.title),
        description: clip(
          typeof row.description === 'string' ? row.description : '',
          2000,
        ),
        status: String(row.status),
        fingerprints: [
          ...new Set(
            [
              row.factoryFingerprint,
              ...learned
                .filter((item) => Number(item.problemId) === id)
                .map((item) => item.fingerprint),
            ].filter((value): value is string => typeof value === 'string'),
          ),
        ],
      });
    }
  }
  return result;
}

export const isTaskKey = (value: string) => TASK_KEY.test(value);
const TASK_PROBLEM_LIMIT = 100;
const clip = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

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
