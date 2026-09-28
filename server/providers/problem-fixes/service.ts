import { randomUUID } from 'node:crypto';
import type { DatabaseManager, RepositoryPolicy, Row } from '@nocobase/db';
import { joinBasePath } from '@nocobase/app-server/support';
import {
  TestProgressNotFoundError,
  type TestProgressService,
} from '../test-progress.js';
import type { ProblemFixGitHubClient } from './github.js';
import {
  FIX_ACTOR,
  ProblemFixError,
  SNAPSHOT_COMMENT_BYTES,
  SNAPSHOT_COMMENT_LIMIT,
  WORKFLOW_RUN_URL,
  fixUsage,
  resultComment,
  type Actor,
  type ClaimInput,
  type FixSnapshot,
  type ResultInput,
} from './model.js';

export interface ProblemFixesOptions {
  /** Absent when the deployment has not declared its public origin. */
  publicOrigin?: string;
  publicBasePath: string;
}
/** The factory identity an integration key is bound to. */
export interface FixSource {
  sourceInstance: string;
  project: string;
}

const now = () => new Date();
const scalar = (value: unknown): string =>
  value instanceof Date
    ? value.toISOString()
    : typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : '';
// A `datetime` column holds wall-clock time in the host's zone (see
// @nocobase/db temporal values); Date parses it as local time, and the HTTP
// contract carries the resulting instant with an explicit zone.
const instant = (value: unknown) => new Date(scalar(value)).toISOString();
const notFound = (): never => {
  throw new ProblemFixError('NOT_FOUND', 'NOT_FOUND');
};
const FAILED_CONCLUSIONS = [
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'startup_failure',
];

export class ProblemFixesService {
  constructor(
    private readonly db: DatabaseManager,
    private readonly github: ProblemFixGitHubClient,
    private readonly problems: TestProgressService,
    private readonly options: ProblemFixesOptions,
    private readonly policies?: Readonly<Record<string, RepositoryPolicy>>,
  ) {}
  withPolicies(policies: Readonly<Record<string, RepositoryPolicy>>) {
    return new ProblemFixesService(
      this.db,
      this.github,
      this.problems,
      this.options,
      policies,
    );
  }
  private runs() {
    const p = this.policies?.problemFixRuns;
    return this.db
      .connection()
      .repository<Row>('problemFixRuns')
      .withPolicy(
        this.policies
          ? {
              read: p?.read ?? false,
              create: p?.create ?? false,
              update: p?.update ?? false,
              delete: false,
            }
          : { read: true, create: true, update: true, delete: false },
      );
  }
  configuration() {
    return {
      configured: this.github.configured,
      repository: this.github.config.repository,
    };
  }
  /**
   * The factory protocol reads problems and writes comments, so it serves only
   * while fixes are enabled, and only the key bound to the configured repository:
   * a report-delivery key for another source cannot claim or answer a fix.
   */
  authorizeSource(source: FixSource) {
    if (!this.github.configured)
      throw new ProblemFixError('NOT_CONFIGURED', 'FACTORY_NOT_CONFIGURED');
    const { repository } = this.github.config;
    if (source.sourceInstance !== repository || source.project !== repository)
      throw new ProblemFixError('FORBIDDEN', 'SOURCE_MISMATCH');
  }
  runView(run?: Row | null) {
    if (!run) return null;
    const result = run.result
      ? (JSON.parse(scalar(run.result)) as Record<string, unknown>)
      : null;
    const workflowRunId = run.workflowRunId ? scalar(run.workflowRunId) : null;
    // Results stored before usage was reported simply have none.
    const usage = fixUsage.safeParse(result?.usage);
    const elapsedMs = result?.elapsedMs;
    return {
      id: scalar(run.id),
      problemId: Number(run.problemId),
      origin: scalar(run.origin),
      status: scalar(run.status),
      active: run.activeProblemId != null,
      requestedByName: scalar(run.requestedByName),
      createdAt: instant(run.createdAt),
      updatedAt: instant(run.updatedAt),
      workflowRunId,
      workflowRunUrl:
        (typeof result?.workflowRunUrl === 'string'
          ? result.workflowRunUrl
          : null) ??
        (workflowRunId
          ? `https://github.com/${scalar(run.repository)}/actions/runs/${workflowRunId}`
          : null),
      error: run.error ? scalar(run.error) : null,
      result: result
        ? {
            verdict: scalar(result.verdict),
            summary: scalar(result.summary),
            pullRequestUrl:
              typeof result.pullRequestUrl === 'string'
                ? result.pullRequestUrl
                : null,
            branch: typeof result.branch === 'string' ? result.branch : null,
            usage: usage.success ? usage.data : null,
            elapsedMs:
              typeof elapsedMs === 'number' && Number.isSafeInteger(elapsedMs)
                ? elapsedMs
                : null,
          }
        : null,
    };
  }
  private async problem(problemId: number) {
    try {
      return await this.problems.getProblem(problemId);
    } catch (error) {
      if (error instanceof TestProgressNotFoundError) return notFound();
      throw error;
    }
  }
  /** Freezes what Claude Code receives: the problem as staff see it now. */
  async capture(problemId: number): Promise<FixSnapshot> {
    const problem = await this.problem(problemId);
    const all = await this.problems.listProblemComments(problemId);
    const comments: FixSnapshot['comments'] = [];
    let bytes = 0;
    for (const comment of [...all].reverse()) {
      const size = Buffer.byteLength(comment.content);
      if (
        comments.length >= SNAPSHOT_COMMENT_LIMIT ||
        bytes + size > SNAPSHOT_COMMENT_BYTES
      )
        break;
      bytes += size;
      comments.unshift({
        authorName: comment.authorName,
        content: comment.content,
        createdAt: comment.createdAt,
      });
    }
    const source = problem.factorySource;
    const origin = this.options.publicOrigin?.replace(/\/+$/, '');
    return {
      version: 1,
      capturedAt: now().toISOString(),
      problemUrl:
        origin && /^https?:\/\//.test(origin)
          ? origin +
            joinBasePath(
              this.options.publicBasePath,
              `/progress/problems/${problem.id}`,
            )
          : null,
      problem: {
        id: problem.id,
        title: problem.title,
        description: problem.description,
        type: problem.type,
        status: problem.status,
        featurePointName: problem.featurePointName,
        owner: problem.owner,
        factorySource: source
          ? {
              reportId: source.reportId,
              taskTitle: source.taskTitle,
              reportUrl: source.reportUrl,
              issueUrl: source.issueUrl,
              pullRequestUrl: source.pullRequestUrl,
              runUrl: source.runUrl,
              environmentUrl: source.environmentUrl,
            }
          : null,
      },
      comments,
      commentsOmitted: all.length - comments.length,
    };
  }
  async list(problemId: number) {
    await this.problem(problemId);
    const runs = await this.runs().findMany({
      filter: { problemId },
      sort: (s) => s.field('createdAt').desc(),
      limit: 100,
    });
    return runs.map((run) => this.runView(run));
  }
  async trigger(problemId: number, requestKey: string, actor: Actor) {
    if (!this.github.configured)
      throw new ProblemFixError('NOT_CONFIGURED', 'FACTORY_NOT_CONFIGURED');
    const existing = await this.runs().findOne({
      filter: { problemId, requestKey },
    });
    if (existing) return this.runView(existing);
    await this.github.verifyWorkflow();
    const snapshot = await this.capture(problemId);
    const id = randomUUID();
    try {
      await this.runs().createOne({
        values: {
          id,
          problemId,
          activeProblemId: problemId,
          requestKey,
          origin: 'testmanage',
          repository: this.github.config.repository,
          status: 'dispatching',
          snapshot: JSON.stringify(snapshot),
          requestedBy: actor.id,
          requestedByName: actor.name,
          createdAt: now(),
          updatedAt: now(),
        },
      });
    } catch (error) {
      const prior = await this.runs().findOne({
        filter: { problemId, requestKey },
      });
      if (prior) return this.runView(prior);
      if (await this.runs().findOne({ filter: { activeProblemId: problemId } }))
        throw new ProblemFixError('ACTIVE_RUN', 'ACTIVE_RUN');
      throw error;
    }
    // The committed activeProblemId is the admission lock. Network work runs
    // after it; an uncertain dispatch is reconciled, never retried blindly.
    let dispatchStarted = false;
    try {
      await this.runs().updateOne({
        filter: { id },
        values: { dispatchRequestedAt: now(), updatedAt: now() },
      });
      dispatchStarted = true;
      const workflowRunId = await this.github.dispatch(problemId, id);
      await this.runs().updateOne({
        filter: { id },
        values: { status: 'queued', workflowRunId, updatedAt: now() },
      });
    } catch (error) {
      const safeError =
        error instanceof ProblemFixError
          ? error.message
          : 'GITHUB_CONNECTION_ERROR';
      // A definite HTTP rejection did not enqueue a workflow. A timeout may have.
      const unknown =
        dispatchStarted &&
        (!(error instanceof ProblemFixError) ||
          /^GITHUB_HTTP_5/.test(error.message));
      await this.runs().updateOne({
        filter: { id },
        values: {
          status: unknown ? 'dispatch_unknown' : 'dispatch_failed',
          error: safeError,
          activeProblemId: unknown ? problemId : null,
          updatedAt: now(),
        },
      });
    }
    return this.runView(await this.runs().findOne({ filter: { id } }));
  }
  async refresh(problemId: number, runId: string) {
    const run = await this.runs().findOne({
      filter: { id: runId, problemId },
    });
    if (!run) return notFound();
    // A stored result is final; so is a run whose lock is already released.
    if (run.result || run.activeProblemId == null) return this.runView(run);
    const remote = run.workflowRunId
      ? await this.github.run(scalar(run.workflowRunId))
      : run.dispatchRequestedAt
        ? await this.github.findRun(runId, instant(run.dispatchRequestedAt))
        : null;
    if (!remote) return this.runView(run);
    const completed = remote.status === 'completed';
    const failed =
      completed && FAILED_CONCLUSIONS.includes(remote.conclusion ?? '');
    const status = failed
      ? remote.conclusion === 'cancelled'
        ? 'cancelled'
        : 'failed'
      : completed
        ? 'awaiting_result'
        : remote.status === 'in_progress' || run.status === 'running'
          ? 'running'
          : 'queued';
    // The result is posted from inside the workflow, so a finished workflow
    // without one will not produce it later; release the problem for another run.
    // Filtering on the lock keeps a concurrently stored result intact.
    await this.runs().updateMany({
      filter: { id: runId, activeProblemId: problemId },
      values: {
        workflowRunId: String(remote.id),
        status,
        ...(completed ? { activeProblemId: null } : {}),
        error: null,
        updatedAt: now(),
      },
    });
    return this.runView(await this.runs().findOne({ filter: { id: runId } }));
  }
  private async read(id: string) {
    return this.db
      .query()
      .selectFrom('problemFixRuns')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }
  /** Binds a workflow execution to its run and hands it the frozen snapshot. */
  async claim(source: FixSource, input: ClaimInput) {
    this.authorizeSource(source);
    if (input.externalRunId) {
      const run = await this.read(input.externalRunId);
      if (!run || Number(run.problemId) !== input.problemId) return notFound();
      if (run.repository !== source.sourceInstance)
        throw new ProblemFixError('FORBIDDEN', 'SOURCE_MISMATCH');
      return { created: false, ...(await this.attach(run, input)) };
    }
    const existing = await this.db
      .query()
      .selectFrom('problemFixRuns')
      .selectAll()
      .where('repository', '=', source.sourceInstance)
      .where('workflowRunId', '=', input.workflowRunId)
      .executeTakeFirst();
    if (existing) {
      if (Number(existing.problemId) !== input.problemId)
        throw new ProblemFixError('CONFLICT', 'RUN_BELONGS_TO_ANOTHER_PROBLEM');
      return { created: false, ...(await this.attach(existing, input)) };
    }
    // A manual dispatch from GitHub is recorded like a staff request, so the
    // same admission lock and history apply to both entry points.
    const snapshot = await this.capture(input.problemId);
    const id = randomUUID();
    try {
      await this.db
        .query()
        .insertInto('problemFixRuns')
        .values({
          id,
          problemId: input.problemId,
          activeProblemId: input.problemId,
          requestKey: null,
          origin: 'github',
          repository: source.sourceInstance,
          status: 'running',
          snapshot: JSON.stringify(snapshot),
          requestedBy: 'github',
          requestedByName: 'GitHub Actions',
          workflowRunId: input.workflowRunId,
          createdAt: now(),
          updatedAt: now(),
        })
        .execute();
    } catch (error) {
      const raced = await this.db
        .query()
        .selectFrom('problemFixRuns')
        .selectAll()
        .where('repository', '=', source.sourceInstance)
        .where('workflowRunId', '=', input.workflowRunId)
        .executeTakeFirst();
      if (raced && Number(raced.problemId) === input.problemId)
        return { created: false, ...(await this.attach(raced, input)) };
      if (await this.active(input.problemId))
        throw new ProblemFixError('ACTIVE_RUN', 'ACTIVE_RUN');
      throw error;
    }
    return { created: true, runId: id, snapshot };
  }
  private active(problemId: number) {
    return this.db
      .query()
      .selectFrom('problemFixRuns')
      .select('id')
      .where('activeProblemId', '=', problemId)
      .executeTakeFirst();
  }
  private async attach(run: Row, input: ClaimInput) {
    if (run.result)
      throw new ProblemFixError('CONFLICT', 'RESULT_ALREADY_RECORDED');
    if (run.workflowRunId && scalar(run.workflowRunId) !== input.workflowRunId)
      throw new ProblemFixError('CONFLICT', 'RUN_ALREADY_CLAIMED');
    // A released run can only come back through a GitHub rerun of the same
    // workflow execution, and only while no other fix holds the problem.
    const reacquire = run.activeProblemId == null;
    if (reacquire && !run.workflowRunId)
      throw new ProblemFixError('CONFLICT', 'RUN_NOT_ACTIVE');
    try {
      const updated = await this.db
        .query()
        .updateTable('problemFixRuns')
        .set({
          workflowRunId: input.workflowRunId,
          status: 'running',
          activeProblemId: input.problemId,
          error: null,
          updatedAt: now(),
        })
        .where('id', '=', scalar(run.id))
        .where('result', 'is', null)
        .execute();
      if ((updated.updatedCount ?? 0) === 0)
        throw new ProblemFixError('CONFLICT', 'RESULT_ALREADY_RECORDED');
    } catch (error) {
      if (reacquire && !(error instanceof ProblemFixError))
        throw new ProblemFixError('ACTIVE_RUN', 'ACTIVE_RUN');
      throw error;
    }
    return {
      runId: scalar(run.id),
      snapshot: JSON.parse(scalar(run.snapshot)) as FixSnapshot,
    };
  }
  /**
   * Records the one result of a claimed execution. The result, its comment and
   * the status change commit together; a replay returns the stored result.
   */
  async report(source: FixSource, runId: string, input: ResultInput) {
    this.authorizeSource(source);
    const run = await this.read(runId);
    if (!run) return notFound();
    if (run.repository !== source.sourceInstance)
      throw new ProblemFixError('FORBIDDEN', 'SOURCE_MISMATCH');
    const url = WORKFLOW_RUN_URL.exec(input.workflowRunUrl);
    if (url?.[1] !== source.sourceInstance || url[2] !== input.workflowRunId)
      throw new ProblemFixError('INVALID_INPUT', 'WORKFLOW_RUN_URL_MISMATCH');
    if (run.result) return this.runView(run);
    if (scalar(run.workflowRunId) !== input.workflowRunId)
      throw new ProblemFixError('CONFLICT', 'RUN_NOT_CLAIMED');
    const problemId = Number(run.problemId);
    const stamp = now();
    // From the request (or the manual claim) to this result. Both instants come
    // from this process's clock: a stored datetime's zone depends on the database.
    const capturedAt = Date.parse(
      (JSON.parse(scalar(run.snapshot)) as FixSnapshot).capturedAt,
    );
    const elapsed = stamp.getTime() - capturedAt;
    const elapsedMs =
      Number.isSafeInteger(elapsed) && elapsed >= 0 ? elapsed : null;
    const result = JSON.stringify({
      ...input,
      reportedAt: stamp.toISOString(),
      elapsedMs,
    });
    // The test-progress service writes outside a transaction, so the comment
    // and status change use its tables directly here to commit atomically with
    // the result: a replay can then never add a second comment or lose one.
    await this.db.transaction(async (connection) => {
      const q = connection.query;
      const stored = await q
        .updateTable('problemFixRuns')
        .set({
          result,
          status: input.verdict === 'error' ? 'failed' : 'completed',
          activeProblemId: null,
          error: null,
          updatedAt: stamp,
        })
        .where('id', '=', runId)
        .where('result', 'is', null)
        .execute();
      if ((stored.updatedCount ?? 0) === 0) return;
      const problem = await q
        .selectFrom('issues')
        .select(['id', 'status'])
        .where('id', '=', problemId)
        .executeTakeFirst();
      if (!problem) return;
      await q
        .insertInto('problemComments')
        .values({
          problemId,
          authorId: FIX_ACTOR.id,
          authorName: FIX_ACTOR.name,
          content: resultComment(input, { elapsedMs }),
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      // A human decision is never overridden: only an untriaged problem moves.
      if (!input.pullRequestUrl || problem.status !== 'pending') return;
      const moved = await q
        .updateTable('issues')
        .set({ status: 'fixing', updatedAt: stamp })
        .where('id', '=', problemId)
        .where('status', '=', 'pending')
        .execute();
      if ((moved.updatedCount ?? 0) === 0) return;
      await q
        .insertInto('problemActivities')
        .values({
          problemId,
          actorId: FIX_ACTOR.id,
          actorName: FIX_ACTOR.name,
          kind: 'status',
          fromStatus: 'pending',
          toStatus: 'fixing',
          createdAt: stamp,
        })
        .execute();
    });
    return this.runView(await this.read(runId));
  }
}
