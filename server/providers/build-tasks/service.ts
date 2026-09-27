import { randomUUID } from 'node:crypto';
import type { DatabaseManager, RepositoryPolicy, Row } from '@nocobase/db';
import type { GitHubBuildClient } from './github.js';
import {
  BuildTaskError,
  issueBody,
  taskInput,
  type Actor,
  type TaskSnapshot,
} from './model.js';
import { precedenceRank, validateDocument } from '../evaluations/protocol.js';

const now = () => new Date();
const scalar = (value: unknown): string =>
  value instanceof Date
    ? value.toISOString()
    : typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : '';
const string = (value: unknown) => (typeof value === 'string' ? value : '');
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
// SQLite returns UTC datetimes without a zone suffix. The HTTP contract must
// include it; otherwise browsers interpret the same instant as local time.
function dated(row: Row): Row {
  const result = { ...row };
  for (const key of ['createdAt', 'updatedAt', 'dispatchRequestedAt']) {
    if (row[key] == null) continue;
    const text = scalar(row[key]);
    result[key] = new Date(
      /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : text + 'Z',
    ).toISOString();
  }
  return result;
}
const notFound = (): never => {
  throw new BuildTaskError('NOT_FOUND', 'NOT_FOUND');
};
const terminal = new Set([
  'completed',
  'failed',
  'cancelled',
  'dispatch_failed',
]);

export class BuildTasksService {
  constructor(
    private readonly db: DatabaseManager,
    private readonly github: GitHubBuildClient,
    private readonly policies?: Readonly<Record<string, RepositoryPolicy>>,
  ) {}
  withPolicies(policies: Readonly<Record<string, RepositoryPolicy>>) {
    return new BuildTasksService(this.db, this.github, policies);
  }
  private repo(name: string, connection = this.db.connection()) {
    const p = this.policies?.[name];
    return connection.repository<Row>(name).withPolicy(
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
  async list() {
    const tasks = await this.repo('buildTasks').findMany({
      sort: (s) => s.field('updatedAt').desc(),
      limit: 200,
    });
    const runs = await this.repo('buildTaskRuns').findMany({
      sort: (s) => s.field('createdAt').desc(),
      limit: 1000,
    });
    return tasks.map((task) => ({
      ...dated(task),
      latestRun: this.runView(runs.find((r) => r.taskId === task.id)),
    }));
  }
  private runView(run?: Row | null) {
    if (!run) return null;
    const { snapshot: _snapshot, activeTaskId, result, ...rest } = run;
    return {
      ...dated(rest),
      active: activeTaskId != null,
      result: result
        ? (JSON.parse(scalar(result)) as Record<string, unknown>)
        : null,
    };
  }
  async detail(id: string) {
    const task = await this.repo('buildTasks').findOne({ filter: { id } });
    if (!task) return notFound();
    const comments = await this.repo('buildTaskComments').findMany({
      filter: { taskId: id },
      sort: (s) => [s.field('createdAt').asc(), s.field('id').asc()],
      limit: 500,
    });
    const runs = await this.repo('buildTaskRuns').findMany({
      filter: { taskId: id },
      sort: (s) => s.field('createdAt').desc(),
      limit: 100,
    });
    return {
      task: dated(task),
      comments: comments.map(dated),
      runs: runs.map((r) => this.runView(r)),
    };
  }
  async save(id: string | null, input: unknown, actor: Actor) {
    const values = taskInput.parse(input);
    if (id) {
      const task = await this.repo('buildTasks').findOne({ filter: { id } });
      if (!task) return notFound();
      const active = await this.repo('buildTaskRuns').findOne({
        filter: { activeTaskId: id },
      });
      if (active) throw new BuildTaskError('ACTIVE_RUN', 'ACTIVE_RUN');
      if (task.issueNumber && values.targetBranch !== task.targetBranch)
        throw new BuildTaskError('CONFLICT', 'TARGET_BRANCH_LOCKED');
      return dated(
        (
          await this.repo('buildTasks').updateOne({
            filter: { id },
            values: { ...values, updatedAt: now() },
          })
        ).record,
      );
    }
    const taskId = randomUUID();
    return dated(
      (
        await this.repo('buildTasks').createOne({
          values: {
            ...values,
            id: taskId,
            targetBranch: values.targetBranch || `apps/tm-${taskId}`,
            repository: this.github.config.repository,
            createdBy: actor.id,
            createdByName: actor.name,
            createdAt: now(),
            updatedAt: now(),
          },
        })
      ).record,
    );
  }
  async comment(id: string, content: string, actor: Actor) {
    if (!(await this.repo('buildTasks').findOne({ filter: { id } })))
      return notFound();
    return dated(
      (
        await this.repo('buildTaskComments').createOne({
          values: {
            id: randomUUID(),
            taskId: id,
            authorId: actor.id,
            authorName: actor.name,
            content,
            createdAt: now(),
          },
        })
      ).record,
    );
  }
  async snapshot(taskId: string, runId: string) {
    if (!(await this.repo('buildTasks').findOne({ filter: { id: taskId } })))
      return notFound();
    const run = await this.repo('buildTaskRuns').findOne({
      filter: { id: runId, taskId },
    });
    if (!run) return notFound();
    return JSON.parse(scalar(run.snapshot)) as TaskSnapshot;
  }
  async trigger(id: string, requestKey: string, actor: Actor) {
    if (!this.github.configured)
      throw new BuildTaskError('NOT_CONFIGURED', 'FACTORY_NOT_CONFIGURED');
    const existing = await this.repo('buildTaskRuns').findOne({
      filter: { taskId: id, requestKey },
    });
    if (existing) return this.runView(existing);
    await this.github.verifyWorkflow();
    let run: Row;
    try {
      run = await this.db.transaction(async (connection) => {
        const task = await this.repo('buildTasks', connection).findOne({
          filter: { id },
        });
        if (!task) return notFound();
        if (task.repository !== this.github.config.repository)
          throw new BuildTaskError('CONFLICT', 'FACTORY_REPOSITORY_CHANGED');
        const comments = await this.repo(
          'buildTaskComments',
          connection,
        ).findMany({
          filter: { taskId: id },
          sort: (s) => [s.field('createdAt').asc(), s.field('id').asc()],
          limit: 501,
        });
        if (comments.length > 500)
          throw new BuildTaskError('INVALID_INPUT', 'TASK_TOO_LARGE');
        const snapshot: TaskSnapshot = {
          ...taskInput.parse(
            Object.fromEntries(
              Object.keys(taskInput.shape).map((k) => [k, task[k]]),
            ),
          ),
          comments: comments.map((c) => ({
            id: String(c.id),
            authorName: String(c.authorName),
            content: String(c.content),
            createdAt: new Date(String(c.createdAt)).toISOString(),
          })),
        };
        const runId = randomUUID();
        issueBody(snapshot, id, runId);
        const created = await this.repo('buildTaskRuns', connection).createOne({
          values: {
            id: runId,
            taskId: id,
            activeTaskId: id,
            requestKey,
            status: 'dispatching',
            snapshot: JSON.stringify(snapshot),
            requestedBy: actor.id,
            requestedByName: actor.name,
            issueNumber: null,
            createdAt: now(),
            updatedAt: now(),
          },
        });
        return created.record;
      });
    } catch (error) {
      const prior = await this.repo('buildTaskRuns').findOne({
        filter: { taskId: id, requestKey },
      });
      if (prior) return this.runView(prior);
      if (
        await this.repo('buildTaskRuns').findOne({
          filter: { activeTaskId: id },
        })
      )
        throw new BuildTaskError('ACTIVE_RUN', 'ACTIVE_RUN');
      throw error;
    }
    // The durable activeTaskId constraint is the admission lock. Network work
    // runs after commit; uncertain dispatches are reconciled, never retried blindly.
    let dispatchStarted = false;
    try {
      const snapshot = JSON.parse(scalar(run.snapshot)) as TaskSnapshot;
      const issueNumber = await this.github.createIssue(
        snapshot.title,
        issueBody(snapshot, id, scalar(run.id)),
      );
      await this.repo('buildTaskRuns').updateOne({
        filter: { id: scalar(run.id) },
        values: {
          issueNumber,
          runKey: `${this.github.config.repository}/issues/${issueNumber}/initial`,
          updatedAt: now(),
        },
      });
      // Persist the new Issue on this run before closing it. A failed close
      // remains visible in history and must not dispatch an unarchived Issue.
      await this.github.closeIssue(issueNumber);
      await this.repo('buildTasks').updateOne({
        filter: { id },
        values: { issueNumber, updatedAt: now() },
      });
      await this.repo('buildTaskRuns').updateOne({
        filter: { id: scalar(run.id) },
        values: { dispatchRequestedAt: now(), updatedAt: now() },
      });
      dispatchStarted = true;
      const workflowRunId = await this.github.dispatch(
        issueNumber,
        scalar(run.id),
      );
      await this.repo('buildTaskRuns').updateOne({
        filter: { id: scalar(run.id) },
        values: { status: 'queued', workflowRunId, updatedAt: now() },
      });
    } catch (error) {
      const safeError =
        error instanceof BuildTaskError
          ? error.message
          : 'GITHUB_CONNECTION_ERROR';
      // A definite HTTP rejection did not enqueue a workflow. A timeout may have.
      const unknown =
        dispatchStarted &&
        (!(error instanceof BuildTaskError) ||
          /^GITHUB_HTTP_5/.test(error.message));
      await this.repo('buildTaskRuns').updateOne({
        filter: { id: scalar(run.id) },
        values: {
          status: unknown ? 'dispatch_unknown' : 'dispatch_failed',
          error: safeError,
          activeTaskId: unknown ? id : null,
          updatedAt: now(),
        },
      });
    }
    return this.runView(
      await this.repo('buildTaskRuns').findOne({
        filter: { id: scalar(run.id) },
      }),
    );
  }
  async refresh(taskId: string, runId: string) {
    if (!(await this.repo('buildTasks').findOne({ filter: { id: taskId } })))
      return notFound();
    let run = await this.repo('buildTaskRuns').findOne({
      filter: { id: runId, taskId },
    });
    if (!run) return notFound();
    // A delayed delivery/restart is repaired from the already-authenticated
    // report store; no new evaluation or GitHub execution is requested here.
    if (run.runKey) {
      const reports = await this.db
        .query()
        .selectFrom('evaluationReports')
        .select(['document', 'reportUrl', 'id'])
        .where('subjectKey', '=', scalar(run.runKey))
        .orderBy('receivedAt', 'desc')
        .limit(30)
        .execute();
      for (const report of reports)
        await this.recordReport(
          JSON.parse(String(report.document)),
          string(report.reportUrl),
          String(report.id),
        );
      run = await this.repo('buildTaskRuns').findOne({
        filter: { id: runId, taskId },
      });
      if (!run) return notFound();
    }
    if (!run.activeTaskId || !run.dispatchRequestedAt) return this.runView(run);
    const remote = run.workflowRunId
      ? await this.github.run(scalar(run.workflowRunId))
      : await this.github.findRun(
          runId,
          new Date(scalar(run.dispatchRequestedAt)).toISOString(),
        );
    if (!remote) return this.runView(run);
    const result = run.result
      ? (JSON.parse(scalar(run.result)) as Record<string, unknown>)
      : null;
    const failed =
      remote.status === 'completed' &&
      [
        'failure',
        'cancelled',
        'timed_out',
        'action_required',
        'startup_failure',
      ].includes(remote.conclusion ?? '');
    const status = failed
      ? remote.conclusion === 'cancelled'
        ? 'cancelled'
        : 'failed'
      : remote.status === 'completed'
        ? result?.execution === 'running'
          ? 'running'
          : 'awaiting_result'
        : remote.status === 'in_progress'
          ? 'running'
          : 'queued';
    await this.repo('buildTaskRuns').updateOne({
      filter: { id: runId, activeTaskId: taskId },
      values: {
        workflowRunId: String(remote.id),
        status,
        ...(failed ? { activeTaskId: null } : {}),
        error: null,
        updatedAt: now(),
      },
    });
    return this.runView(
      await this.repo('buildTaskRuns').findOne({ filter: { id: runId } }),
    );
  }
  // Only called after the existing source-bound import has authenticated and
  // validated a report, or for the same immutable stored report during refresh.
  async recordReport(raw: unknown, reportUrl: string, reportId: string) {
    const document = validateDocument(raw);
    if (
      document.type !== 'evaluation-report' ||
      document.source.instance !== this.github.config.repository ||
      document.source.project !== this.github.config.repository
    )
      return;
    const producer = object(object(document.precedence).producer);
    const startedAt = Date.parse(string(producer.startedAt));
    if (!Number.isFinite(startedAt)) return;
    const candidates = await this.db
      .query()
      .selectFrom('buildTaskRuns')
      .selectAll()
      .where('runKey', '=', document.run.key)
      .orderBy('createdAt', 'desc')
      .execute();
    // Prefer exact GitHub identity. A continuation belongs to its ancestor, not
    // every historical execution included in an accumulated report.
    const executions = Array.isArray(document.executions)
      ? document.executions.map(object)
      : [];
    const ancestry = new Set<string>();
    let cursor = scalar(producer.runId);
    while (cursor && !ancestry.has(cursor)) {
      ancestry.add(cursor);
      const execution = executions.find((e) => scalar(e.runId) === cursor);
      cursor = execution ? scalar(execution.previousRunId) : '';
    }
    const run =
      candidates.find(
        (r) => r.workflowRunId && ancestry.has(scalar(r.workflowRunId)),
      ) ??
      candidates.find(
        (r) =>
          !r.workflowRunId &&
          r.dispatchRequestedAt &&
          Date.parse(scalar(r.dispatchRequestedAt)) <= startedAt + 1000,
      );
    if (!run) return;
    const rank = precedenceRank(document);
    const outcome = object(document.outcome),
      execution = object(outcome.execution),
      acceptance = object(outcome.acceptance),
      delivery = object(outcome.delivery);
    const executionState =
      string(execution.state) ||
      (typeof outcome.execution === 'string' ? outcome.execution : 'unknown');
    const acceptanceState =
      string(acceptance.state) ||
      (typeof outcome.acceptance === 'string' ? outcome.acceptance : 'unknown');
    const deliveryState =
      string(delivery.state) ||
      (typeof outcome.delivery === 'string' ? outcome.delivery : 'unknown');
    const links = Array.isArray(document.links)
      ? (document.links as Array<Record<string, unknown>>)
      : [];
    const pull = object(outcome.pullRequest);
    const pr = Number(pull.number);
    const status =
      executionState === 'running'
        ? 'running'
        : executionState === 'cancelled'
          ? 'cancelled'
          : executionState === 'completed'
            ? acceptanceState === 'failed'
              ? 'failed'
              : 'completed'
            : ['timed-out', 'budget-exhausted', 'blocked'].includes(
                  executionState,
                )
              ? 'failed'
              : 'awaiting_result';
    const result = {
      reportId,
      reportUrl,
      revision: document.revision,
      rank,
      execution: executionState,
      acceptance: acceptanceState,
      delivery: deliveryState,
      pullRequestUrl:
        pr > 0
          ? `https://github.com/${this.github.config.repository}/pull/${pr}`
          : null,
      runUrl: `https://github.com/${this.github.config.repository}/actions/runs/${Number(producer.runId)}`,
      environmentUrl:
        string(links.find((l) => l.rel === 'preview')?.url) || null,
    };
    let current = run;
    for (let attempt = 0; attempt < 8; attempt++) {
      const old = current.result
        ? (JSON.parse(scalar(current.result)) as Record<string, unknown>)
        : null;
      if (old && string(old.rank) >= rank) return;
      // A report import and a refresh can race. Compare the stored result in
      // the UPDATE itself so an older delivery cannot overwrite a newer one.
      const updated = await this.db
        .query()
        .updateTable('buildTaskRuns')
        .set({
          status,
          result: JSON.stringify(result),
          activeTaskId: terminal.has(status) ? null : current.activeTaskId,
          error: null,
          updatedAt: now(),
        })
        .where('id', '=', scalar(run.id))
        .where(
          'result',
          current.result == null ? 'is' : '=',
          current.result ?? null,
        )
        .execute();
      if ((updated.updatedCount ?? 0) > 0) return;
      const latest = await this.db
        .query()
        .selectFrom('buildTaskRuns')
        .selectAll()
        .where('id', '=', scalar(run.id))
        .executeTakeFirst();
      if (!latest) return;
      current = latest;
    }
    throw new Error('Build task report update conflicted; retry delivery.');
  }
}
