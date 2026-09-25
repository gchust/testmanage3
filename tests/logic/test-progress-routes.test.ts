// @vitest-environment node

import {
  authenticationToken,
  type Auth,
} from '@nocobase/app-plugin-authentication';
import type { Application } from '@nocobase/app-server/application';
import { ServiceContainer } from '@nocobase/service-provider';
import type { Context } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import {
  TestProgressConflictError,
  TestProgressNotFoundError,
  testProgressServiceToken,
  type TestProgressService,
} from '../../server/providers/test-progress.js';
import { testProgressApiRoutes } from '../../server/routes/test-progress.js';
import { evaluationServiceToken } from '../../server/providers/evaluations/index.js';
import type { EvaluationService } from '../../server/providers/evaluations/service.js';

const AUTHORIZED_HEADERS = { 'x-test-user': 'tester' };

/** Stands in for the authentication plugin: a header decides the session. */
function createFakeAuth(): Auth {
  const required =
    () =>
    async (
      context: Context,
      next: () => Promise<void>,
    ): Promise<Response | void> => {
      const username = context.req.header('x-test-user');
      if (username === undefined) {
        return context.json({ code: 'UNAUTHORIZED' }, 401);
      }
      // The real middleware puts the Better Auth session on the context.
      context.set('auth', {
        user: { id: `user-${username}`, username, name: username },
        session: {},
      });

      await next();
    };

  return { required, optional: required } as unknown as Auth;
}

function createStubService(
  overrides: Partial<TestProgressService> = {},
): TestProgressService {
  return {
    listFeaturePoints: vi.fn(async () => []),
    getFeaturePoint: vi.fn(async () => {
      throw new TestProgressNotFoundError('not found');
    }),
    createFeaturePoint: vi.fn(async () => ({ id: 7 }) as never),
    updateFeaturePoint: vi.fn(async () => ({ id: 7 }) as never),
    deleteFeaturePoint: vi.fn(async () => undefined),
    listProblems: vi.fn(async () => []),
    getProblem: vi.fn(async () => {
      throw new TestProgressNotFoundError('not found');
    }),
    createProblem: vi.fn(async () => ({ id: 11 }) as never),
    updateProblem: vi.fn(async () => ({ id: 11 }) as never),
    deleteProblem: vi.fn(async () => undefined),
    listMembers: vi.fn(async () => []),
    listProblemActivities: vi.fn(async () => []),
    listProblemComments: vi.fn(async () => []),
    createProblemComment: vi.fn(async () => ({ id: 21 }) as never),
    deleteProblemComment: vi.fn(async () => undefined),
    getSummary: vi.fn(async () => ({ totals: {} }) as never),
    ...overrides,
  };
}

async function createRouter(
  service: TestProgressService,
  attachment?: EvaluationService['attachment'],
): Promise<{
  request: (input: string, init?: RequestInit) => Response | Promise<Response>;
}> {
  const container = new ServiceContainer();
  container.instance(authenticationToken, createFakeAuth());
  container.instance(testProgressServiceToken, service);
  if (attachment)
    container.instance(evaluationServiceToken, {
      attachment,
    } as EvaluationService);

  return testProgressApiRoutes.createRouter({
    container,
  } as unknown as Application);
}

describe('test progress API routes', () => {
  it('downloads the problem report after authentication and rejects arbitrary file paths', async () => {
    const attachment = vi.fn(async () => ({
      bytes: Buffer.from('<html>Report</html>'),
      contentType: 'text/html',
    }));
    const service = createStubService({
      getProblem: vi.fn(
        async () =>
          ({ id: 12, factorySource: { reportId: 'report-12' } }) as never,
      ),
    });
    const router = await createRouter(service, attachment);
    expect(
      (await router.request('/test-progress/problems/12/report')).status,
    ).toBe(401);
    expect(attachment).not.toHaveBeenCalled();
    const response = await router.request(
      '/test-progress/problems/12/report?path=report.html',
      { headers: AUTHORIZED_HEADERS },
    );
    expect(response.status).toBe(200);
    expect(attachment).toHaveBeenCalledWith('report-12', 'report.html');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="report.html"',
    );
    expect(response.headers.get('content-security-policy')).toContain(
      'sandbox',
    );
    expect(
      (
        await router.request(
          '/test-progress/problems/12/report?path=../../config.yml',
          { headers: AUTHORIZED_HEADERS },
        )
      ).status,
    ).toBe(404);
  });
  it('rejects anonymous requests before reaching the service', async () => {
    const service = createStubService();
    const router = await createRouter(service);

    const response = await router.request('/test-progress/feature-points');

    expect(response.status).toBe(401);
    expect(service.listFeaturePoints).not.toHaveBeenCalled();
  });

  it('returns the list for an authenticated caller', async () => {
    const service = createStubService();
    const router = await createRouter(service);

    const response = await router.request('/test-progress/feature-points', {
      headers: AUTHORIZED_HEADERS,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [] });
  });

  it('does not protect paths it does not own', async () => {
    const router = await createRouter(createStubService());

    const response = await router.request('/somewhere-else');

    expect(response.status).toBe(404);
  });

  it('maps validation, missing and conflicting input to 400, 404 and 409', async () => {
    const service = createStubService({
      deleteFeaturePoint: vi.fn(async () => {
        throw new TestProgressConflictError('has children');
      }),
    });
    const router = await createRouter(service);

    const invalidJson = await router.request('/test-progress/feature-points', {
      method: 'POST',
      headers: { ...AUTHORIZED_HEADERS, 'content-type': 'application/json' },
      body: '{',
    });
    expect(invalidJson.status).toBe(400);

    const missingName = await router.request('/test-progress/feature-points', {
      method: 'POST',
      headers: { ...AUTHORIZED_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'feature', parentId: 1 }),
    });
    expect(missingName.status).toBe(400);
    await expect(missingName.json()).resolves.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    const notFound = await router.request('/test-progress/feature-points/999', {
      headers: AUTHORIZED_HEADERS,
    });
    expect(notFound.status).toBe(404);

    const conflict = await router.request('/test-progress/feature-points/4', {
      method: 'DELETE',
      headers: AUTHORIZED_HEADERS,
    });
    expect(conflict.status).toBe(409);

    const badQuery = await router.request(
      '/test-progress/problems?featurePointId=abc',
      { headers: AUTHORIZED_HEADERS },
    );
    expect(badQuery.status).toBe(400);
  });

  it('lists members and filters problems by owner', async () => {
    const service = createStubService();
    const router = await createRouter(service);

    const anonymous = await router.request('/test-progress/members');
    expect(anonymous.status).toBe(401);

    const members = await router.request('/test-progress/members', {
      headers: AUTHORIZED_HEADERS,
    });
    expect(members.status).toBe(200);
    expect(service.listMembers).toHaveBeenCalled();

    const mine = await router.request(
      '/test-progress/problems?owner=%E9%99%88%E9%9C%96',
      { headers: AUTHORIZED_HEADERS },
    );
    expect(mine.status).toBe(200);
    expect(service.listProblems).toHaveBeenCalledWith({ owner: '陈霖' });

    const mineById = await router.request(
      '/test-progress/problems?ownerId=account-chenlin',
      { headers: AUTHORIZED_HEADERS },
    );
    expect(mineById.status).toBe(200);
    expect(service.listProblems).toHaveBeenCalledWith({
      ownerId: 'account-chenlin',
    });
  });

  it('creates a feature point with 201 and deletes a problem with 204', async () => {
    const service = createStubService();
    const router = await createRouter(service);

    const created = await router.request('/test-progress/feature-points', {
      method: 'POST',
      headers: { ...AUTHORIZED_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'new feature',
        level: 'feature',
        parentId: 4,
      }),
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toEqual({ data: { id: 7 } });
    expect(service.createFeaturePoint).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'new feature',
        level: 'feature',
        parentId: 4,
      }),
    );

    const deleted = await router.request('/test-progress/problems/11', {
      method: 'DELETE',
      headers: AUTHORIZED_HEADERS,
    });
    expect(deleted.status).toBe(204);
    expect(service.deleteProblem).toHaveBeenCalledWith(11);
  });

  it('serves problems under the same authentication', async () => {
    const service = createStubService();
    const router = await createRouter(service);

    const anonymous = await router.request('/test-progress/problems');
    expect(anonymous.status).toBe(401);

    const listed = await router.request(
      '/test-progress/problems?type=example&status=pending&open=true',
      { headers: AUTHORIZED_HEADERS },
    );
    expect(listed.status).toBe(200);
    expect(service.listProblems).toHaveBeenCalledWith({
      type: 'example',
      status: 'pending',
      open: true,
    });

    const badStatus = await router.request(
      '/test-progress/problems?status=nonsense',
      { headers: AUTHORIZED_HEADERS },
    );
    expect(badStatus.status).toBe(400);

    const cancelled = await router.request(
      '/test-progress/problems?status=cancelled',
      { headers: AUTHORIZED_HEADERS },
    );
    expect(cancelled.status).toBe(200);
    expect(service.listProblems).toHaveBeenCalledWith({ status: 'cancelled' });

    const badType = await router.request('/test-progress/problems?type=nope', {
      headers: AUTHORIZED_HEADERS,
    });
    expect(badType.status).toBe(400);

    const created = await router.request('/test-progress/problems', {
      method: 'POST',
      headers: { ...AUTHORIZED_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '登录偶发失败',
        featurePointId: 15,
        type: 'manual',
      }),
    });
    expect(created.status).toBe(201);
    expect(service.createProblem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '登录偶发失败',
        featurePointId: 15,
        type: 'manual',
        status: 'pending',
      }),
      { id: 'user-tester', name: 'tester' },
    );

    const updated = await router.request('/test-progress/problems/11', {
      method: 'PATCH',
      headers: { ...AUTHORIZED_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'regression' }),
    });
    expect(updated.status).toBe(200);
    expect(service.updateProblem).toHaveBeenCalledWith(
      11,
      { status: 'regression' },
      { id: 'user-tester', name: 'tester' },
    );

    const deleted = await router.request('/test-progress/problems/11', {
      method: 'DELETE',
      headers: AUTHORIZED_HEADERS,
    });
    expect(deleted.status).toBe(204);
    expect(service.deleteProblem).toHaveBeenCalledWith(11);
  });

  it('attributes comments to the session and only lets the author delete', async () => {
    const service = createStubService();
    const router = await createRouter(service);

    const anonymous = await router.request(
      '/test-progress/problems/3/comments',
    );
    expect(anonymous.status).toBe(401);

    const listed = await router.request('/test-progress/problems/3/comments', {
      headers: AUTHORIZED_HEADERS,
    });
    expect(listed.status).toBe(200);
    expect(service.listProblemComments).toHaveBeenCalledWith(3);

    const created = await router.request('/test-progress/problems/3/comments', {
      method: 'POST',
      headers: { ...AUTHORIZED_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ content: '**复现了**' }),
    });
    expect(created.status).toBe(201);
    expect(service.createProblemComment).toHaveBeenCalledWith(
      3,
      { content: '**复现了**' },
      { id: 'user-tester', name: 'tester' },
    );

    const empty = await router.request('/test-progress/problems/3/comments', {
      method: 'POST',
      headers: { ...AUTHORIZED_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ content: '   ' }),
    });
    expect(empty.status).toBe(400);

    const deleted = await router.request('/test-progress/problem-comments/21', {
      method: 'DELETE',
      headers: AUTHORIZED_HEADERS,
    });
    expect(deleted.status).toBe(204);
    expect(service.deleteProblemComment).toHaveBeenCalledWith(21, {
      id: 'user-tester',
      name: 'tester',
    });
  });

  it('serves the problem timeline', async () => {
    const service = createStubService();
    const router = await createRouter(service);

    const anonymous = await router.request(
      '/test-progress/problems/3/activities',
    );
    expect(anonymous.status).toBe(401);

    const listed = await router.request(
      '/test-progress/problems/3/activities',
      { headers: AUTHORIZED_HEADERS },
    );
    expect(listed.status).toBe(200);
    expect(service.listProblemActivities).toHaveBeenCalledWith(3);
  });
});
