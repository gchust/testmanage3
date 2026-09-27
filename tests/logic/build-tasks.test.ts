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
  await migration.up(context);
  const github = {
    config,
    configured: true,
    verifyWorkflow: vi.fn(async () => {}),
    saveIssue: vi.fn<
      (_number: number | null, _title: string, _body: string) => Promise<number>
    >(async () => 146),
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
    expect(github.saveIssue.mock.calls[0]?.[2]).toContain(
      'Escalate after 24 hours.',
    );
    expect((await service.trigger(id, key, actor))?.id).toBe(first?.id);
    expect(github.dispatch).toHaveBeenCalledTimes(1);
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
    expect(github.saveIssue.mock.calls[1]?.[0]).toBe(146);
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
  it('does not send an Issue until the external entry guard is installed', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: Buffer.from('workflow_dispatch:').toString('base64'),
        }),
      ),
    );
    await expect(
      new GitHubBuildClient(config, request).verifyWorkflow(),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
});

describe('build task routes', () => {
  it('rejects anonymous and unpermitted requests and accepts a permitted draft without dispatching', async () => {
    const { service, github } = await setup();
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
    const app = new Hono().route('/', router);
    expect((await app.request('/build-tasks')).status).toBe(401);
    expect(
      (await app.request('/build-tasks', { headers: { 'x-test-user': '1' } }))
        .status,
    ).toBe(403);
    const headers = {
      'x-test-user': '1',
      'x-test-grant': '1',
      'content-type': 'application/json',
    };
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
});
