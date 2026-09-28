// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { createDatabaseManager, type MigrationContext } from '@nocobase/db';
import { sqlite } from '@nocobase/db-sqlite';
import { ServiceContainer } from '@nocobase/service-provider';
import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import type { Application } from '@nocobase/app-server/application';
import { Hono, type MiddlewareHandler } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import evaluationsMigration from '../../database/main/migrations/202609250001_create_evaluations.js';
import reportLinksMigration from '../../database/main/migrations/202609250003_reference_factory_reports.js';
import migration from '../../database/main/migrations/202609270001_create_build_tasks.js';
import { BuildTasksService } from '../../server/providers/build-tasks/service.js';
import { GitHubBuildClient } from '../../server/providers/build-tasks/github.js';
import {
  BuildTaskError,
  issueBody,
} from '../../server/providers/build-tasks/model.js';
import { buildTasksServiceToken } from '../../server/providers/build-tasks/index.js';
import { buildTaskRoutes } from '../../server/routes/build-tasks.js';
import reportFixture from '../fixtures/factory-report.json';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});
const actor = { id: 'staff', name: 'Staff' };
const input = {
  title: 'Service desk',
  requirements: 'Employees submit tickets.',
  acceptanceCriteria: 'An employee sees their own tickets.',
  taskType: 'create' as const,
  targetBranch: '',
  sampleData: true,
  buildReview: 'auto' as const,
};
const config = {
  enabled: true,
  repository: 'owner/factory',
  workflow: 'code-agent-task.yml',
  ref: 'develop',
  token: 'not-a-real-token',
};
async function setup() {
  const db = createDatabaseManager({
    default: 'main',
    connections: { main: sqlite({ filename: ':memory:' }) },
  });
  disposers.push(() => db.destroy());
  const context = {
    builder: db.builder(),
    query: db.query(),
    connection: db.connection(),
  } as unknown as MigrationContext;
  // Refresh replays stored reports; releases write the integration audit log.
  await evaluationsMigration.up(context);
  await reportLinksMigration.up(context);
  await migration.up(context);
  let nextIssue = 146;
  const github = {
    config,
    configured: true,
    verifyWorkflow: vi.fn(async () => {}),
    createIssue: vi.fn<(_title: string, _body: string) => Promise<number>>(
      async () => nextIssue++,
    ),
    closeIssue: vi.fn<(_number: number) => Promise<void>>(async () => {}),
    dispatch: vi.fn(async () => '100'),
    run: vi.fn(),
    findRun: vi.fn(),
  };
  const service = new BuildTasksService(
    db,
    github as unknown as GitHubBuildClient,
  );
  return { db, context, github, service };
}
describe('build tasks', () => {
  it('creates a task without dispatch, appends comments and reverses the migration', async () => {
    const { service, github, context, db } = await setup();
    const task = await service.save(null, input, actor);
    expect(task.targetBranch).toMatch(/^apps\/tm-/);
    expect(task.createdAt).toMatch(/Z$/);
    expect(task.updatedAt).toMatch(/Z$/);
    expect(github.dispatch).not.toHaveBeenCalled();
    await service.comment(String(task.id), 'Also add escalation.', actor);
    const detail = await service.detail(String(task.id));
    expect(detail.comments).toHaveLength(1);
    expect(detail.comments[0].createdAt).toMatch(/Z$/);
    await migration.down!(context);
    await expect(
      db.query().selectFrom('buildTasks').selectAll().execute(),
    ).rejects.toThrow();
    await migration.up(context);
    expect(await service.list()).toEqual([]);
  });
  it('captures comments once and deduplicates requests while rejecting another active run', async () => {
    const { service, github } = await setup();
    const task = await service.save(null, input, actor),
      id = String(task.id);
    await service.comment(id, 'Escalate after 24 hours.', actor);
    const key = randomUUID(),
      first = await service.trigger(id, key, actor);
    expect(first).toMatchObject({
      status: 'queued',
      active: true,
      workflowRunId: '100',
    });
    expect(first?.createdAt).toMatch(/Z$/);
    expect(first?.dispatchRequestedAt).toMatch(/Z$/);
    await service.comment(id, 'Add workload charts.', actor);
    const snapshot = await service.snapshot(id, String(first?.id));
    expect(snapshot.comments).toHaveLength(1);
    expect(github.createIssue.mock.calls[0]?.[1]).toContain(
      'Escalate after 24 hours.',
    );
    expect((await service.trigger(id, key, actor))?.id).toBe(first?.id);
    expect(github.dispatch).toHaveBeenCalledTimes(1);
    expect(github.createIssue).toHaveBeenCalledTimes(1);
    expect(github.closeIssue).toHaveBeenCalledExactlyOnceWith(146);
    expect(github.closeIssue.mock.invocationCallOrder[0]).toBeLessThan(
      github.dispatch.mock.invocationCallOrder[0],
    );
    await expect(
      service.trigger(id, randomUUID(), actor),
    ).rejects.toMatchObject({ code: 'ACTIVE_RUN' });
    await expect(service.save(id, input, actor)).rejects.toMatchObject({
      code: 'ACTIVE_RUN',
    });
  });
  it('keeps a timed-out dispatch active and reconciles the exact external request', async () => {
    const { service, github } = await setup();
    github.dispatch.mockRejectedValueOnce(new Error('Timeout'));
    const task = await service.save(null, input, actor),
      id = String(task.id);
    const run = await service.trigger(id, randomUUID(), actor);
    expect(run).toMatchObject({
      status: 'dispatch_unknown',
      active: true,
      error: 'GITHUB_CONNECTION_ERROR',
    });
    await expect(
      service.trigger(id, randomUUID(), actor),
    ).rejects.toMatchObject({ code: 'ACTIVE_RUN' });
    expect(github.dispatch).toHaveBeenCalledTimes(1);
  });
  it('allows a fresh submission after a definite GitHub rejection', async () => {
    const { service, github } = await setup();
    github.dispatch.mockRejectedValueOnce(
      new BuildTaskError('GITHUB_ERROR', 'GITHUB_HTTP_422'),
    );
    const task = await service.save(null, input, actor),
      id = String(task.id);
    expect(await service.trigger(id, randomUUID(), actor)).toMatchObject({
      status: 'dispatch_failed',
      active: false,
    });
    expect(await service.trigger(id, randomUUID(), actor)).toMatchObject({
      status: 'queued',
      active: true,
    });
    expect(github.createIssue).toHaveBeenCalledTimes(2);
    expect(github.closeIssue.mock.calls).toEqual([[146], [147]]);
    expect(github.dispatch).toHaveBeenLastCalledWith(147, expect.any(String));
  });
  it('retains an Issue when closing fails and does not dispatch or recreate it on replay', async () => {
    const { service, github } = await setup();
    github.closeIssue.mockRejectedValueOnce(
      new BuildTaskError('GITHUB_ERROR', 'GITHUB_HTTP_403'),
    );
    const task = await service.save(null, input, actor),
      id = String(task.id);
    const key = randomUUID();
    const run = await service.trigger(id, key, actor);
    expect(run).toMatchObject({
      issueNumber: 146,
      status: 'dispatch_failed',
      active: false,
    });
    expect(github.dispatch).not.toHaveBeenCalled();
    expect((await service.trigger(id, key, actor))?.id).toBe(run?.id);
    expect(github.createIssue).toHaveBeenCalledTimes(1);
    expect((await service.detail(id)).runs[0]?.issueNumber).toBe(146);
  });
  it('links reports to their producer run and protects newer submissions from late results', async () => {
    const { service, github, db } = await setup();
    const task = await service.save(null, input, actor),
      id = String(task.id);
    const first = await service.trigger(id, randomUUID(), actor);
    const stamp = '2026-09-21T14:13:19Z';
    await db
      .query()
      .updateTable('buildTaskRuns')
      .set({ dispatchRequestedAt: new Date(stamp) })
      .where('id', '=', String(first?.id))
      .execute();
    const report = {
      ...structuredClone(reportFixture),
      outcome: {
        execution: 'completed',
        acceptance: 'passed',
        delivery: 'published',
        pullRequest: { number: 150 },
      },
    };
    await service.recordReport(
      report,
      'https://owner.github.io/factory/report.html',
      'report-1',
    );
    let detail = await service.detail(id);
    expect(detail.runs[0]).toMatchObject({
      active: false,
      status: 'completed',
      result: { acceptance: 'passed', delivery: 'published' },
    });
    github.dispatch.mockResolvedValueOnce('200');
    const second = await service.trigger(id, randomUUID(), actor);
    expect(first?.issueNumber).toBe(146);
    expect(second?.issueNumber).toBe(147);
    expect((await service.detail(id)).task.issueNumber).toBe(147);
    expect(github.closeIssue.mock.calls).toEqual([[146], [147]]);
    await service.recordReport(
      { ...report, revision: 2 },
      'https://owner.github.io/factory/report.html',
      'report-2',
    );
    detail = await service.detail(id);
    expect(detail.runs.find((r) => r?.id === second?.id)).toMatchObject({
      active: true,
      status: 'queued',
      result: null,
    });
    const foreign = {
      ...report,
      source: { ...report.source, instance: 'other/factory' },
    };
    await service.recordReport(foreign, '', 'foreign');
    expect(
      (await service.detail(id)).runs.find((r) => r?.id === second?.id)?.active,
    ).toBe(true);
  });
  it('reads stored wall-clock datetimes as the instants written on a host west of UTC', async () => {
    const zone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const { service, github, db } = await setup();
      // Without a run id from dispatch, only the request time links a report.
      github.dispatch.mockResolvedValueOnce(null as never);
      const task = await service.save(null, input, actor),
        id = String(task.id);
      await service.comment(id, 'Escalate after 24 hours.', actor);
      const run = await service.trigger(id, randomUUID(), actor);
      await db
        .query()
        .updateTable('buildTaskRuns')
        .set({ dispatchRequestedAt: new Date('2026-09-21T14:13:19.000Z') })
        .where('id', '=', String(run?.id))
        .execute();
      await db
        .query()
        .updateTable('buildTaskComments')
        .set({ createdAt: new Date('2026-09-21T14:00:00.000Z') })
        .where('taskId', '=', id)
        .execute();
      // The column keeps Los Angeles wall-clock time without a zone.
      expect(
        (
          await db
            .query()
            .selectFrom('buildTaskRuns')
            .select('dispatchRequestedAt')
            .where('id', '=', String(run?.id))
            .executeTakeFirst()
        )?.dispatchRequestedAt,
      ).toBe('2026-09-21T07:13:19.000');
      github.findRun.mockResolvedValueOnce(null);
      await service.refresh(id, String(run?.id));
      expect(github.findRun).toHaveBeenCalledWith(
        run?.id,
        '2026-09-21T14:13:19.000Z',
      );
      // The producer started one second after the request.
      await service.recordReport(
        {
          ...structuredClone(reportFixture),
          outcome: {
            pullRequest: null,
            execution: 'completed',
            acceptance: 'passed',
            delivery: 'published',
          },
        },
        '',
        'report-west',
      );
      const detail = await service.detail(id);
      expect(detail.runs[0]).toMatchObject({
        status: 'completed',
        active: false,
        dispatchRequestedAt: '2026-09-21T14:13:19.000Z',
        result: { reportId: 'report-west' },
      });
      expect(detail.comments[0]?.createdAt).toBe('2026-09-21T14:00:00.000Z');
      github.dispatch.mockResolvedValueOnce('200');
      await service.trigger(id, randomUUID(), actor);
      expect(github.createIssue.mock.calls[1]?.[1]).toContain(
        '2026-09-21T14:00:00.000Z',
      );
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
  it('releases a run whose report never arrived and records who did it', async () => {
    const { service, github, db } = await setup();
    const task = await service.save(null, input, actor),
      id = String(task.id);
    const run = await service.trigger(id, randomUUID(), actor);
    github.run.mockResolvedValueOnce({
      id: 100,
      status: 'completed',
      conclusion: 'success',
    });
    expect(await service.refresh(id, String(run?.id))).toMatchObject({
      status: 'awaiting_result',
      active: true,
    });
    await expect(service.save(id, input, actor)).rejects.toMatchObject({
      code: 'ACTIVE_RUN',
    });
    expect(
      await service.release(id, String(run?.id), { id: 'lead', name: 'Lead' }),
    ).toMatchObject({
      status: 'abandoned',
      active: false,
      error: 'RELEASED',
      released: { byName: 'Lead', at: expect.stringMatching(/Z$/) },
    });
    const audit = await db
      .query()
      .selectFrom('evaluationAudit')
      .selectAll()
      .where('target', '=', String(run?.id))
      .execute();
    expect(audit).toMatchObject([
      { actorId: 'lead', action: 'buildTaskRun.release' },
    ]);
    expect(JSON.parse(String(audit[0]?.detail))).toEqual({
      taskId: id,
      fromStatus: 'awaiting_result',
      actorName: 'Lead',
    });
    expect((await service.detail(id)).runs[0]).toMatchObject({
      status: 'abandoned',
      released: { byName: 'Lead' },
    });
    await expect(
      service.release(id, String(run?.id), actor),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'RUN_NOT_ACTIVE' });
    await expect(
      service.release(id, randomUUID(), actor),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    github.run.mockClear();
    expect(await service.refresh(id, String(run?.id))).toMatchObject({
      status: 'abandoned',
    });
    expect(github.run).not.toHaveBeenCalled();
    await service.save(id, input, actor);
    github.dispatch.mockResolvedValueOnce('200');
    expect(await service.trigger(id, randomUUID(), actor)).toMatchObject({
      status: 'queued',
      active: true,
    });
  });
  it('records a report that arrives after a release without taking the task back', async () => {
    const { service, github } = await setup();
    const task = await service.save(null, input, actor),
      id = String(task.id);
    const first = await service.trigger(id, randomUUID(), actor);
    await service.release(id, String(first?.id), actor);
    github.dispatch.mockResolvedValueOnce('200');
    const second = await service.trigger(id, randomUUID(), actor);
    const report = (execution: string, revision: number) => ({
      ...structuredClone(reportFixture),
      revision,
      outcome: {
        pullRequest: null,
        execution,
        acceptance: execution === 'completed' ? 'passed' : 'not-run',
        delivery: 'not-published',
      },
    });
    await service.recordReport(report('running', 1), '', 'report-running');
    let runs = (await service.detail(id)).runs;
    expect(runs.find((r) => r?.id === first?.id)).toMatchObject({
      status: 'abandoned',
      active: false,
      result: { reportId: 'report-running', execution: 'running' },
    });
    expect(runs.find((r) => r?.id === second?.id)).toMatchObject({
      status: 'queued',
      active: true,
    });
    await service.recordReport(report('completed', 2), '', 'report-final');
    runs = (await service.detail(id)).runs;
    expect(runs.find((r) => r?.id === first?.id)).toMatchObject({
      status: 'completed',
      active: false,
      result: { reportId: 'report-final' },
    });
    expect(runs.find((r) => r?.id === second?.id)).toMatchObject({
      active: true,
    });
  });
  it('keeps a release made while GitHub is being called', async () => {
    const { service, github } = await setup();
    const task = await service.save(null, input, actor),
      id = String(task.id);
    github.dispatch.mockImplementationOnce(async (_issue, runId) => {
      await service.release(id, runId, actor);
      throw new Error('Timeout');
    });
    expect(await service.trigger(id, randomUUID(), actor)).toMatchObject({
      status: 'abandoned',
      active: false,
    });
    github.dispatch.mockImplementationOnce(async (_issue, runId) => {
      await service.release(id, runId, actor);
      return '300';
    });
    expect(await service.trigger(id, randomUUID(), actor)).toMatchObject({
      status: 'abandoned',
      active: false,
    });
    github.dispatch.mockResolvedValueOnce('301');
    expect(await service.trigger(id, randomUUID(), actor)).toMatchObject({
      status: 'queued',
      active: true,
    });
  });
  it('keeps the newest report when deliveries race', async () => {
    const { service } = await setup();
    const task = await service.save(null, input, actor);
    await service.trigger(String(task.id), randomUUID(), actor);
    await Promise.all(
      [3, 2, 1].map((revision) =>
        service.recordReport(
          {
            ...structuredClone(reportFixture),
            revision,
            outcome: {
              pullRequest: null,
              execution: 'completed',
              acceptance: revision === 3 ? 'passed' : 'failed',
              delivery: 'published',
            },
          },
          '',
          `report-${revision}`,
        ),
      ),
    );
    const detail = await service.detail(String(task.id));
    expect(detail.runs[0]).toMatchObject({
      status: 'completed',
      active: false,
      result: { revision: 3, reportId: 'report-3', acceptance: 'passed' },
    });
  });
  it('links a continued execution only through its recorded ancestor', async () => {
    const { service } = await setup();
    const task = await service.save(null, input, actor);
    await service.trigger(String(task.id), randomUUID(), actor);
    const report = {
      ...structuredClone(reportFixture),
      precedence: {
        ...reportFixture.precedence,
        producer: { ...reportFixture.precedence.producer, runId: 200 },
      },
      outcome: {
        pullRequest: null,
        execution: 'completed',
        acceptance: 'passed',
        delivery: 'published',
      },
    };
    await service.recordReport(report, '', 'unrelated');
    expect((await service.detail(String(task.id))).runs[0]?.result).toBeNull();
    await service.recordReport(
      {
        ...report,
        executions: [
          { runId: 100, previousRunId: null },
          { runId: 200, previousRunId: 100 },
        ],
      },
      '',
      'continued',
    );
    expect((await service.detail(String(task.id))).runs[0]).toMatchObject({
      active: false,
      status: 'completed',
      workflowRunId: '100',
      result: {
        reportId: 'continued',
        runUrl: 'https://github.com/owner/factory/actions/runs/200',
      },
    });
  });
  it('enforces actual repository row and field policies', async () => {
    const { service } = await setup();
    const task = await service.save(null, input, actor);
    const denied = service.withPolicies({
      buildTasks: { read: false },
      buildTaskComments: { read: false },
      buildTaskRuns: { read: false },
    });
    await expect(denied.detail(String(task.id))).rejects.toThrow();
    const missingCommentScope = service.withPolicies({
      buildTasks: { read: true },
    });
    await expect(
      missingCommentScope.comment(String(task.id), 'No grant', actor),
    ).rejects.toThrow();
    expect((await service.detail(String(task.id))).comments).toHaveLength(0);
  });
  it('keeps the assigned branch when an edit leaves it blank', async () => {
    const { service, github } = await setup();
    const task = await service.save(null, input, actor),
      id = String(task.id);
    expect(
      await service.save(id, { ...input, title: 'Renamed' }, actor),
    ).toMatchObject({ title: 'Renamed', targetBranch: task.targetBranch });
    expect(
      await service.save(id, { ...input, targetBranch: 'apps/renamed' }, actor),
    ).toMatchObject({ targetBranch: 'apps/renamed' });
    await service.trigger(id, randomUUID(), actor);
    expect(github.createIssue.mock.calls[0]?.[1]).toContain(
      '### 目标分支\n\napps/renamed',
    );
  });
  it('treats user Markdown headings as content instead of control fields', () => {
    const body = issueBody(
      {
        ...input,
        requirements: 'Hello\n### 目标分支\nprotected',
        comments: [
          {
            id: 'c',
            authorName: 'User',
            content: '### 框架评测\n轻量',
            createdAt: 'now',
          },
        ],
      },
      'task',
      'run',
    );
    expect(body.match(/^### 目标分支$/gm)).toHaveLength(1);
    expect(body.match(/^### 框架评测$/gm)).toHaveLength(1);
  });
});

describe('GitHub bridge', () => {
  it('creates a fresh externally guarded Issue and only closes that new Issue', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ number: 147 }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ number: 147, state: 'closed' })),
      );
    const client = new GitHubBuildClient(config, request);
    expect(
      await client.createIssue('New submission', 'Frozen requirements'),
    ).toBe(147);
    await client.closeIssue(147);
    expect(
      request.mock.calls.map(([url, options]) => ({
        url,
        method: options?.method,
        body: JSON.parse(String(options?.body)),
      })),
    ).toEqual([
      {
        url: 'https://api.github.com/repos/owner/factory/issues',
        method: 'POST',
        body: {
          title: 'New submission',
          body: 'Frozen requirements',
          labels: ['factory:external'],
        },
      },
      {
        url: 'https://api.github.com/repos/owner/factory/issues/147',
        method: 'PATCH',
        body: { state: 'closed' },
      },
    ]);
  });
  it('sends only server credentials and supports the documented run-id response', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ workflow_run_id: 234 }), { status: 200 }),
      );
    const client = new GitHubBuildClient(config, request);
    expect(await client.dispatch(146, 'external-id')).toBe('234');
    const [url, options] = request.mock.calls[0];
    expect(url).toContain('/actions/workflows/code-agent-task.yml/dispatches');
    expect(JSON.parse(String(options?.body))).toEqual({
      ref: 'develop',
      inputs: { issue_number: '146', external_run_id: 'external-id' },
    });
    expect(options?.redirect).toBe('error');
  });
  it('validates GitHub run responses and pages through dispatches to find a request', async () => {
    const page = (runs: unknown[], total: number) =>
      new Response(JSON.stringify({ total_count: total, workflow_runs: runs }));
    const run = (id: number, title: string | null) => ({
      id,
      status: 'queued',
      conclusion: null,
      display_title: title,
    });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        page(
          Array.from({ length: 100 }, (_, i) =>
            run(i + 1, `request other-${i}`),
          ),
          150,
        ),
      )
      .mockResolvedValueOnce(
        page([run(500, null), run(501, 'Build · request wanted')], 150),
      );
    const client = new GitHubBuildClient(config, request);
    expect(await client.findRun('wanted', '2026-09-28T00:00:00.000Z')).toEqual(
      run(501, 'Build · request wanted'),
    );
    expect(request.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining(
        '&page=1&created=%3E%3D2026-09-28T00%3A00%3A00.000Z',
      ),
      expect.stringContaining('&page=2&'),
    ]);
    request.mockReset().mockResolvedValueOnce(page([run(1, 'request x')], 1));
    expect(await client.findRun('missing', '2026-09-28T00:00:00.000Z')).toBe(
      null,
    );
    expect(request).toHaveBeenCalledTimes(1);
    request
      .mockReset()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'x', status: 'queued' })),
      );
    await expect(client.run('100')).rejects.toMatchObject({
      code: 'GITHUB_ERROR',
      message: 'GITHUB_RESPONSE_INVALID',
    });
  });
  it('does not send an Issue until the external entry guard is installed', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: Buffer.from(
            'workflow_dispatch: factory:external external_run_id',
          ).toString('base64'),
        }),
      ),
    );
    await expect(
      new GitHubBuildClient(config, request).verifyWorkflow(),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
});

describe('build task routes', () => {
  async function routes() {
    const fixture = await setup();
    const { service } = fixture;
    const container = new ServiceContainer();
    container.instance(buildTasksServiceToken, service);
    const authenticated: MiddlewareHandler = async (c, next) => {
      if (!c.req.header('x-test-user')) return c.json({}, 401);
      c.set('auth', { user: { id: 'staff', name: 'Staff' } });
      await next();
    };
    container.instance(authenticationToken, {
      required: () => authenticated,
    } as never);
    container.instance(authorizationToken, {
      middleware: () => async (c, next) => {
        c.set('authz', {
          authorize: async () =>
            c.req.header('x-test-grant')
              ? {
                  effect: 'allow',
                  conditions: {
                    type: 'resource',
                    database: Object.fromEntries(
                      ['buildTasks', 'buildTaskComments', 'buildTaskRuns'].map(
                        (name) => [
                          name,
                          { read: true, create: true, update: true },
                        ],
                      ),
                    ),
                  },
                }
              : { effect: 'deny' },
        });
        await next();
      },
    } as { middleware: () => MiddlewareHandler } as never);
    const router = await buildTaskRoutes.createRouter({
      container,
    } as Application);
    return { ...fixture, app: new Hono().route('/', router) };
  }
  const headers = {
    'x-test-user': '1',
    'x-test-grant': '1',
    'content-type': 'application/json',
  };
  it('rejects anonymous and unpermitted requests and accepts a permitted draft without dispatching', async () => {
    const { app, github } = await routes();
    expect((await app.request('/build-tasks')).status).toBe(401);
    expect(
      (await app.request('/build-tasks', { headers: { 'x-test-user': '1' } }))
        .status,
    ).toBe(403);
    const response = await app.request('/build-tasks', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(201);
    const { data } = await response.json();
    expect(data.title).toBe(input.title);
    expect(github.dispatch).not.toHaveBeenCalled();
    expect(
      (
        await app.request(`/build-tasks/${data.id}/runs`, {
          method: 'POST',
          headers,
        })
      ).status,
    ).toBe(400);
    expect((await app.request('/unrelated')).status).toBe(404);
  });
  it('releases an active run only for a permitted user and only while it holds the task', async () => {
    const { app, github } = await routes();
    github.dispatch.mockRejectedValueOnce(new Error('Timeout'));
    const created = await app.request('/build-tasks', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });
    const task = (await created.json()).data;
    const runs = `/build-tasks/${task.id}/runs`;
    const started = await app.request(runs, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
    });
    const run = (await started.json()).data;
    expect(run).toMatchObject({ status: 'dispatch_unknown', active: true });
    const release = `${runs}/${run.id}/release`;
    expect((await app.request(release, { method: 'POST' })).status).toBe(401);
    expect(
      (
        await app.request(release, {
          method: 'POST',
          headers: { 'x-test-user': '1' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(`${runs}/${randomUUID()}/release`, {
          method: 'POST',
          headers,
        })
      ).status,
    ).toBe(404);
    const released = await app.request(release, { method: 'POST', headers });
    expect(released.status).toBe(200);
    expect((await released.json()).data).toMatchObject({
      status: 'abandoned',
      active: false,
      released: { byName: 'Staff' },
    });
    const again = await app.request(release, { method: 'POST', headers });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ message: 'RUN_NOT_ACTIVE' });
    github.dispatch.mockResolvedValueOnce('200');
    expect(
      (
        await app.request(runs, {
          method: 'POST',
          headers: { ...headers, 'Idempotency-Key': randomUUID() },
        })
      ).status,
    ).toBe(202);
  });
});
