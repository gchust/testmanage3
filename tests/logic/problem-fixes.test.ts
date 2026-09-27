// @vitest-environment node
import { randomUUID } from 'node:crypto';
import {
  createDatabaseManager,
  type DatabaseManager,
  type MigrationContext,
} from '@nocobase/db';
import { sqlite } from '@nocobase/db-sqlite';
import { ServiceContainer } from '@nocobase/service-provider';
import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import type { Application } from '@nocobase/app-server/application';
import { Hono, type MiddlewareHandler } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import testProgressMigration from '../../database/main/migrations/202609210001_create_test_progress_tables.js';
import issuesMigration from '../../database/main/migrations/202609210003_create_issues.js';
import problemTypeMigration from '../../database/main/migrations/202609220001_add_issue_type_and_owner.js';
import commentsMigration from '../../database/main/migrations/202609220002_create_problem_comments.js';
import activitiesMigration from '../../database/main/migrations/202609220003_create_problem_activities.js';
import ownerIdMigration from '../../database/main/migrations/202609220006_add_owner_id.js';
import factoryMigration from '../../database/main/migrations/202609250002_collect_factory_problems.js';
import migration from '../../database/main/migrations/202609270002_create_problem_fix_runs.js';
import permissionSeed from '../../database/main/seeds/202609270002_seed_problem_fix_permissions.js';
import { createTestProgressService } from '../../server/providers/test-progress.js';
import { ProblemFixesService } from '../../server/providers/problem-fixes/service.js';
import { ProblemFixGitHubClient } from '../../server/providers/problem-fixes/github.js';
import {
  COMMENT_LIMIT,
  ProblemFixError,
  resultComment,
  resultInput,
  type ResultInput,
} from '../../server/providers/problem-fixes/model.js';
import { problemFixesServiceToken } from '../../server/providers/problem-fixes/index.js';
import { evaluationServiceToken } from '../../server/providers/evaluations/index.js';
import { problemFixRoutes } from '../../server/routes/problem-fixes.js';

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});
const actor = { id: 'staff', name: 'Staff' };
const source = { sourceInstance: 'owner/factory' };
const config = {
  enabled: true,
  repository: 'owner/factory',
  workflow: 'framework-fix.yml',
  ref: 'develop',
  token: 'not-a-real-token',
};
function context(db: DatabaseManager) {
  return {
    builder: db.builder(),
    query: db.query(),
    connection: db.connection(),
  } as unknown as MigrationContext;
}
async function setup() {
  const db = createDatabaseManager({
    default: 'main',
    connections: { main: sqlite({ filename: ':memory:' }) },
  });
  disposers.push(() => db.destroy());
  await db.builder().createCollection('user', (c) => {
    c.string('id', { primaryKey: true, length: 64, nullable: false });
    c.string('name', { length: 255, nullable: false });
    c.string('username', { length: 255 });
    c.datetime('createdAt');
    c.datetime('disabledAt');
    c.datetime('deletedAt');
  });
  for (const step of [
    testProgressMigration,
    issuesMigration,
    problemTypeMigration,
    commentsMigration,
    activitiesMigration,
    ownerIdMigration,
    factoryMigration,
    migration,
  ])
    await step.up(context(db));
  const problems = createTestProgressService(db);
  const problem = await problems.createProblem({
    title: 'Refine table loses its filter',
    description: 'Steps: open the list, filter, reload.',
    featurePointId: null,
    type: 'automation',
  });
  await problems.createProblemComment(
    problem.id,
    { content: 'Seen again on beta.47.' },
    { id: 'u1', name: 'Tester' },
  );
  const github = {
    config,
    configured: true,
    verifyWorkflow: vi.fn(async () => {}),
    dispatch: vi.fn<(_problemId: number, _runId: string) => Promise<string>>(
      async () => '100',
    ),
    run: vi.fn(),
    findRun: vi.fn(),
  };
  const service = new ProblemFixesService(
    db,
    github as unknown as ProblemFixGitHubClient,
    problems,
    { publicOrigin: 'https://test3.example', publicBasePath: '/main' },
  );
  return { db, github, service, problems, problemId: problem.id };
}
function result(overrides: Partial<ResultInput> = {}): ResultInput {
  return resultInput.parse({
    workflowRunId: '100',
    workflowRunUrl: 'https://github.com/owner/factory/actions/runs/100',
    verdict: 'confirmed',
    summary: 'The filter state is dropped on reload.',
    analysis: 'Root cause is in the list state serializer.',
    pullRequestUrl: 'https://github.com/nocobase/nocobase3/pull/12',
    branch: 'claude/problem-1',
    baseSha: 'a'.repeat(40),
    ...overrides,
  });
}

describe('problem fix runs', () => {
  it('reverses the migration', async () => {
    const { db, service, problemId } = await setup();
    await migration.down!(context(db));
    await expect(
      db.query().selectFrom('problemFixRuns').selectAll().execute(),
    ).rejects.toThrow();
    await migration.up(context(db));
    expect(await service.list(problemId)).toEqual([]);
  });
  it('freezes the problem once, deduplicates a click and rejects a second active run', async () => {
    const { service, github, problems, problemId } = await setup();
    const key = randomUUID();
    const first = await service.trigger(problemId, key, actor);
    expect(first).toMatchObject({
      status: 'queued',
      active: true,
      origin: 'testmanage',
      workflowRunId: '100',
      workflowRunUrl: 'https://github.com/owner/factory/actions/runs/100',
      result: null,
    });
    expect(first?.createdAt).toMatch(/Z$/);
    expect(first).not.toHaveProperty('snapshot');
    expect(github.dispatch).toHaveBeenCalledExactlyOnceWith(
      problemId,
      first?.id,
    );
    await problems.createProblemComment(
      problemId,
      { content: 'Added after the run started.' },
      { id: 'u1', name: 'Tester' },
    );
    expect((await service.trigger(problemId, key, actor))?.id).toBe(first?.id);
    expect(github.dispatch).toHaveBeenCalledTimes(1);
    await expect(
      service.trigger(problemId, randomUUID(), actor),
    ).rejects.toMatchObject({ code: 'ACTIVE_RUN' });
    const claim = await service.claim(source, {
      problemId,
      externalRunId: String(first?.id),
      workflowRunId: '100',
      workflowRunAttempt: 1,
    });
    expect(claim.snapshot).toMatchObject({
      version: 1,
      problemUrl: `https://test3.example/main/progress/problems/${problemId}`,
      problem: {
        id: problemId,
        title: 'Refine table loses its filter',
        status: 'pending',
        factorySource: null,
      },
      comments: [{ authorName: 'Tester', content: 'Seen again on beta.47.' }],
      commentsOmitted: 0,
    });
  });
  it('keeps a timed-out dispatch locked and releases a definite rejection', async () => {
    const { service, github, problemId } = await setup();
    github.dispatch.mockRejectedValueOnce(new Error('Timeout'));
    expect(await service.trigger(problemId, randomUUID(), actor)).toMatchObject(
      {
        status: 'dispatch_unknown',
        active: true,
        error: 'GITHUB_CONNECTION_ERROR',
      },
    );
    await expect(
      service.trigger(problemId, randomUUID(), actor),
    ).rejects.toMatchObject({ code: 'ACTIVE_RUN' });

    const other = await setup();
    other.github.dispatch.mockRejectedValueOnce(
      new ProblemFixError('GITHUB_ERROR', 'GITHUB_HTTP_422'),
    );
    expect(
      await other.service.trigger(other.problemId, randomUUID(), actor),
    ).toMatchObject({ status: 'dispatch_failed', active: false });
    expect(
      await other.service.trigger(other.problemId, randomUUID(), actor),
    ).toMatchObject({ status: 'queued', active: true });
  });
  it('reconciles GitHub state without overwriting a stored result', async () => {
    const { service, github, problemId } = await setup();
    github.dispatch.mockResolvedValueOnce(null as never);
    const run = await service.trigger(problemId, randomUUID(), actor);
    github.findRun.mockResolvedValueOnce({
      id: 300,
      status: 'in_progress',
      conclusion: null,
    });
    expect(await service.refresh(problemId, String(run?.id))).toMatchObject({
      status: 'running',
      active: true,
      workflowRunId: '300',
    });
    expect(github.findRun).toHaveBeenCalledWith(run?.id, expect.any(String));
    github.run.mockResolvedValueOnce({
      id: 300,
      status: 'completed',
      conclusion: 'failure',
    });
    expect(await service.refresh(problemId, String(run?.id))).toMatchObject({
      status: 'failed',
      active: false,
    });

    const second = await service.trigger(problemId, randomUUID(), actor);
    await service.claim(source, {
      problemId,
      externalRunId: String(second?.id),
      workflowRunId: '100',
      workflowRunAttempt: 1,
    });
    await service.report(source, String(second?.id), result());
    github.run.mockClear();
    expect(await service.refresh(problemId, String(second?.id))).toMatchObject({
      status: 'completed',
      result: { verdict: 'confirmed' },
    });
    expect(github.run).not.toHaveBeenCalled();
  });
  it('releases a finished workflow that never reported and accepts its rerun', async () => {
    const { service, github, problemId } = await setup();
    const run = await service.trigger(problemId, randomUUID(), actor);
    github.run.mockResolvedValueOnce({
      id: 100,
      status: 'completed',
      conclusion: 'success',
    });
    expect(await service.refresh(problemId, String(run?.id))).toMatchObject({
      status: 'awaiting_result',
      active: false,
    });
    const rerun = await service.claim(source, {
      problemId,
      externalRunId: String(run?.id),
      workflowRunId: '100',
      workflowRunAttempt: 2,
    });
    expect(rerun.runId).toBe(run?.id);
    expect((await service.list(problemId))[0]).toMatchObject({
      status: 'running',
      active: true,
    });
  });
  it('binds one workflow execution to a run and refuses foreign or conflicting claims', async () => {
    const { service, problemId } = await setup();
    const run = await service.trigger(problemId, randomUUID(), actor);
    const claim = {
      problemId,
      externalRunId: String(run?.id),
      workflowRunId: '100',
      workflowRunAttempt: 1,
    };
    await expect(
      service.claim({ sourceInstance: 'other/factory' }, claim),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.claim(source, { ...claim, problemId: problemId + 1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await service.claim(source, claim)).created).toBe(false);
    expect((await service.claim(source, claim)).runId).toBe(run?.id);
    await expect(
      service.claim(source, { ...claim, workflowRunId: '101' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await service.report(source, String(run?.id), result());
    await expect(service.claim(source, claim)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
  it('records a manual GitHub dispatch as a run under the same lock', async () => {
    const { service, problemId } = await setup();
    const claim = {
      problemId,
      externalRunId: null,
      workflowRunId: '500',
      workflowRunAttempt: 1,
    };
    const first = await service.claim(source, claim);
    expect(first).toMatchObject({
      created: true,
      snapshot: { problem: { id: problemId } },
    });
    expect(await service.claim(source, claim)).toMatchObject({
      created: false,
      runId: first.runId,
    });
    expect((await service.list(problemId))[0]).toMatchObject({
      origin: 'github',
      status: 'running',
      active: true,
      requestedByName: 'GitHub Actions',
      workflowRunUrl: 'https://github.com/owner/factory/actions/runs/500',
    });
    await expect(
      service.claim(source, { ...claim, workflowRunId: '501' }),
    ).rejects.toMatchObject({ code: 'ACTIVE_RUN' });
    await expect(
      service.trigger(problemId, randomUUID(), actor),
    ).rejects.toMatchObject({ code: 'ACTIVE_RUN' });
    await expect(
      service.claim(source, { ...claim, problemId: 999 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      service.claim(source, {
        ...claim,
        problemId: 999,
        workflowRunId: '502',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('comments once and moves only a pending problem to fixing when a PR exists', async () => {
    const { service, github, problems, problemId } = await setup();
    // Without a run id from dispatch, only a claim binds the execution.
    github.dispatch.mockResolvedValueOnce(null as never);
    const run = await service.trigger(problemId, randomUUID(), actor);
    const runId = String(run?.id);
    await expect(service.report(source, runId, result())).rejects.toMatchObject(
      { code: 'CONFLICT' },
    );
    await service.claim(source, {
      problemId,
      externalRunId: runId,
      workflowRunId: '100',
      workflowRunAttempt: 1,
    });
    await expect(
      service.report(
        source,
        runId,
        result({
          workflowRunUrl: 'https://github.com/other/factory/actions/runs/100',
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const stored = await service.report(source, runId, result());
    expect(stored).toMatchObject({
      status: 'completed',
      active: false,
      result: {
        verdict: 'confirmed',
        pullRequestUrl: 'https://github.com/nocobase/nocobase3/pull/12',
        branch: 'claude/problem-1',
      },
    });
    await service.report(source, runId, result({ summary: 'Replayed.' }));
    const comments = await problems.listProblemComments(problemId);
    expect(comments).toHaveLength(2);
    expect(comments[1]).toMatchObject({
      authorId: null,
      authorName: 'Claude Code',
    });
    expect(comments[1]?.content).toContain('确认存在并已提交修复 PR');
    expect(comments[1]?.content).toContain(
      'https://github.com/nocobase/nocobase3/pull/12',
    );
    expect(comments[1]?.content).not.toContain('Replayed.');
    expect((await problems.getProblem(problemId)).status).toBe('fixing');
    const activities = await problems.listProblemActivities(problemId);
    expect(activities.at(-1)).toMatchObject({
      actorName: 'Claude Code',
      kind: 'status',
      fromStatus: 'pending',
      toStatus: 'fixing',
    });
  });
  it('leaves a human-set status and a PR-less verdict alone', async () => {
    const { service, problems, problemId } = await setup();
    await problems.updateProblem(problemId, { status: 'regression' });
    const first = await service.claim(source, {
      problemId,
      externalRunId: null,
      workflowRunId: '600',
      workflowRunAttempt: 1,
    });
    await service.report(
      source,
      first.runId,
      result({
        workflowRunId: '600',
        workflowRunUrl: 'https://github.com/owner/factory/actions/runs/600',
      }),
    );
    expect((await problems.getProblem(problemId)).status).toBe('regression');

    const other = await setup();
    const claim = await other.service.claim(source, {
      problemId: other.problemId,
      externalRunId: null,
      workflowRunId: '700',
      workflowRunAttempt: 1,
    });
    const view = await other.service.report(
      source,
      claim.runId,
      result({
        workflowRunId: '700',
        workflowRunUrl: 'https://github.com/owner/factory/actions/runs/700',
        verdict: 'not_reproducible',
        pullRequestUrl: null,
      }),
    );
    expect(view).toMatchObject({ status: 'completed', active: false });
    expect((await other.problems.getProblem(other.problemId)).status).toBe(
      'pending',
    );
    expect(
      (await other.problems.listProblemComments(other.problemId)).at(-1)
        ?.content,
    ).toContain('无法复现');
  });
  it('records the usage and total time with the result and in its comment', async () => {
    const { service, problems, problemId } = await setup();
    const usage = {
      engine: 'claude-code',
      model: 'opus',
      durationMs: 718_517,
      turns: 67,
      costUsd: 3.7372,
      tokens: {
        input: 110,
        output: 36_580,
        cacheRead: 3_760_135,
        cacheWrite: 94_205,
        total: 3_891_030,
      },
      complete: true,
    };
    const claim = await service.claim(source, {
      problemId,
      externalRunId: null,
      workflowRunId: '800',
      workflowRunAttempt: 1,
    });
    const view = await service.report(
      source,
      claim.runId,
      result({
        workflowRunId: '800',
        workflowRunUrl: 'https://github.com/owner/factory/actions/runs/800',
        usage,
      }),
    );
    expect(view?.result?.usage).toEqual(usage);
    expect(view?.result?.elapsedMs).toEqual(expect.any(Number));
    const comment = (await problems.listProblemComments(problemId)).at(
      -1,
    )?.content;
    expect(comment).toContain(
      '- 用量：3,891,030 tokens（输入 110 · 输出 36,580 · 缓存写入 94,205 · 缓存读取 3,760,135） · 会话 11 分 59 秒 · 67 轮 · 按标价约 $3.74',
    );
    expect(comment).toMatch(/- 总耗时：\d+ 秒（从发起到回传结论）/);

    // A result reported before usage existed still reads back, without usage.
    const old = await setup();
    const oldClaim = await old.service.claim(source, {
      problemId: old.problemId,
      externalRunId: null,
      workflowRunId: '900',
      workflowRunAttempt: 1,
    });
    const legacy = await old.service.report(
      source,
      oldClaim.runId,
      result({
        workflowRunId: '900',
        workflowRunUrl: 'https://github.com/owner/factory/actions/runs/900',
      }),
    );
    expect(legacy?.result?.usage).toBeNull();
    expect(
      (await old.problems.listProblemComments(old.problemId)).at(-1)?.content,
    ).not.toContain('用量');
  });
  it('accepts only well-formed usage', () => {
    const usage = {
      engine: 'claude-code',
      model: 'opus',
      durationMs: null,
      turns: null,
      costUsd: null,
      tokens: {
        input: 1,
        output: 2,
        cacheRead: null,
        cacheWrite: null,
        total: null,
      },
      complete: false,
    };
    expect(result({ usage }).usage).toEqual(usage);
    expect(resultComment(result({ usage }))).toContain(
      '- 用量：未知 tokens（输入 1 · 输出 2 · 缓存写入 未知 · 缓存读取 未知）（用量报告不完整）',
    );
    for (const bad of [
      { ...usage, model: 'opus](https://evil.example)' },
      { ...usage, turns: 1.5 },
      { ...usage, costUsd: -1 },
      { ...usage, extra: true },
      { ...usage, tokens: { ...usage.tokens, reasoning: 1 } },
    ])
      expect(() => result({ usage: bad as never })).toThrow();
  });
  it('rejects a PR on an unconfirmed verdict and keeps long analysis within the comment limit', () => {
    expect(() => result({ verdict: 'needs_info' })).toThrow();
    const comment = resultComment(result({ analysis: 'x'.repeat(20000) }));
    expect(comment.length).toBeLessThanOrEqual(COMMENT_LIMIT);
    expect(comment).toContain('已截断');
    expect(comment).toContain(
      'https://github.com/owner/factory/actions/runs/100',
    );
  });
});

describe('problem fix permission set', () => {
  it('adds an unassigned read/run operator once', async () => {
    const { db } = await setup();
    // The Authorization plugin's permission-set table, reduced to the seed's columns.
    await db.builder().createCollection('authorizationPermissionSets', (c) => {
      c.string('id', { primaryKey: true, length: 64 });
      c.string('key', { length: 255, nullable: false, unique: true });
      c.string('title', { length: 255 });
      c.json('grants', { nullable: false });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
    });
    const seedContext = {
      query: db.query(),
      connection: db.connection(),
    } as never;
    await permissionSeed.run(seedContext);
    await permissionSeed.run(seedContext);
    const rows = await db
      .query()
      .selectFrom('authorizationPermissionSets')
      .selectAll()
      .where('key', '=', 'problem-fix-operator')
      .execute();
    expect(rows).toHaveLength(1);
    const grants = JSON.parse(String(rows[0]?.grants)) as Array<{
      resource: { id: string };
      actions: Array<{ action: string }>;
    }>;
    expect(grants).toHaveLength(1);
    expect(grants[0]?.resource.id).toBe('problemFixes');
    expect(grants[0]?.actions.map((a) => a.action).sort()).toEqual([
      'read',
      'run',
    ]);
  });
});

describe('problem fix GitHub entry', () => {
  it('dispatches only the problem and run identity with server credentials', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ workflow_run_id: 234 }), { status: 200 }),
      );
    const client = new ProblemFixGitHubClient(config, request);
    expect(await client.dispatch(7, 'external-id')).toBe('234');
    const [url, options] = request.mock.calls[0];
    expect(url).toBe(
      'https://api.github.com/repos/owner/factory/actions/workflows/framework-fix.yml/dispatches',
    );
    expect(JSON.parse(String(options?.body))).toEqual({
      ref: 'develop',
      inputs: { problem_id: '7', external_run_id: 'external-id' },
    });
    expect(options?.redirect).toBe('error');
  });
  it('refuses to dispatch until the workflow advertises the fix entry', async () => {
    const workflow = (text: string) =>
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ content: Buffer.from(text).toString('base64') }),
          ),
        );
    await expect(
      new ProblemFixGitHubClient(
        config,
        workflow('workflow_dispatch: external_run_id'),
      ).verifyWorkflow(),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    await expect(
      new ProblemFixGitHubClient(
        config,
        workflow('# testmanage:problem-fix-v1\nexternal_run_id'),
      ).verifyWorkflow(),
    ).resolves.toBeUndefined();
    expect(
      new ProblemFixGitHubClient({ ...config, token: '' }).configured,
    ).toBe(false);
  });
});

describe('problem fix routes', () => {
  async function routes(configured = true) {
    const fixture = await setup();
    fixture.github.configured = configured;
    const container = new ServiceContainer();
    container.instance(problemFixesServiceToken, fixture.service);
    container.instance(evaluationServiceToken, {
      authenticate: async (secret: string) =>
        secret === 'integration-secret' ? source : null,
    } as never);
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
                    database: {
                      problemFixRuns: {
                        read: true,
                        create: true,
                        update: true,
                      },
                    },
                  },
                }
              : { effect: 'deny' },
        });
        await next();
      },
    } as { middleware: () => MiddlewareHandler } as never);
    const router = await problemFixRoutes.createRouter({
      container,
    } as Application);
    return { ...fixture, app: new Hono().route('/', router) };
  }
  const staff = {
    'x-test-user': '1',
    'x-test-grant': '1',
    'content-type': 'application/json',
  };
  it('requires a session and the problemFixes permission for staff actions', async () => {
    const { app, problemId, github } = await routes();
    const path = `/problem-fixes/problems/${problemId}/runs`;
    expect((await app.request(path)).status).toBe(401);
    expect(
      (await app.request(path, { headers: { 'x-test-user': '1' } })).status,
    ).toBe(403);
    const list = await app.request(path, { headers: staff });
    expect(list.status).toBe(200);
    expect((await list.json()).data).toEqual({
      runs: [],
      configured: true,
      repository: 'owner/factory',
    });
    expect(
      (await app.request(path, { method: 'POST', headers: staff })).status,
    ).toBe(400);
    const key = randomUUID();
    const response = await app.request(path, {
      method: 'POST',
      headers: { ...staff, 'Idempotency-Key': key },
    });
    expect(response.status).toBe(202);
    expect((await response.json()).data).toMatchObject({ status: 'queued' });
    expect(
      (
        await app.request(path, {
          method: 'POST',
          headers: { ...staff, 'Idempotency-Key': randomUUID() },
        })
      ).status,
    ).toBe(409);
    expect(github.dispatch).toHaveBeenCalledTimes(1);
    expect(
      (
        await app.request('/problem-fixes/problems/999/runs', {
          headers: staff,
        })
      ).status,
    ).toBe(404);
    expect(
      (await app.request('/problem-fixes/unknown', { headers: staff })).status,
    ).toBe(404);
  });
  it('reports an unconfigured integration without creating a run', async () => {
    const { app, problemId, service } = await routes(false);
    const response = await app.request(
      `/problem-fixes/problems/${problemId}/runs`,
      {
        method: 'POST',
        headers: { ...staff, 'Idempotency-Key': randomUUID() },
      },
    );
    expect(response.status).toBe(503);
    expect(await service.list(problemId)).toEqual([]);
  });
  it('accepts only the source-bound integration key on the factory protocol', async () => {
    const { app, problemId, problems } = await routes();
    const claim = JSON.stringify({
      problemId,
      externalRunId: null,
      workflowRunId: '800',
      workflowRunAttempt: 1,
    });
    const post = (
      path: string,
      headers: Record<string, string>,
      body: string,
    ) =>
      app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
      });
    expect(
      (await post('/problem-fixes/factory/claims', {}, claim)).status,
    ).toBe(401);
    expect(
      (
        await post(
          '/problem-fixes/factory/claims',
          { 'x-test-user': '1', 'x-test-grant': '1' },
          claim,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await post(
          '/problem-fixes/factory/claims',
          { 'x-api-key': 'wrong' },
          claim,
        )
      ).status,
    ).toBe(401);
    const key = { authorization: 'Bearer integration-secret' };
    const created = await post('/problem-fixes/factory/claims', key, claim);
    expect(created.status).toBe(201);
    const { data } = await created.json();
    expect(data.snapshot.problem.id).toBe(problemId);
    expect(
      (await post('/problem-fixes/factory/claims', key, claim)).status,
    ).toBe(200);
    expect(
      (await post('/problem-fixes/factory/claims', key, '{"problemId":1}'))
        .status,
    ).toBe(400);
    const body = JSON.stringify({
      workflowRunId: '800',
      workflowRunUrl: 'https://github.com/owner/factory/actions/runs/800',
      verdict: 'already_fixed',
      summary: 'Fixed by nocobase3 commit abc.',
      analysis: '',
      pullRequestUrl: null,
      branch: null,
      baseSha: null,
    });
    const path = `/problem-fixes/factory/runs/${data.runId}/result`;
    const stored = await post(
      path,
      { 'x-api-key': 'integration-secret' },
      body,
    );
    expect(stored.status).toBe(200);
    expect((await stored.json()).data).toMatchObject({
      status: 'completed',
      result: { verdict: 'already_fixed' },
    });
    expect(
      (await post(path, { 'x-api-key': 'integration-secret' }, body)).status,
    ).toBe(200);
    expect(
      (await problems.listProblemComments(problemId)).filter(
        (c) => c.authorName === 'Claude Code',
      ),
    ).toHaveLength(1);
  });
});
