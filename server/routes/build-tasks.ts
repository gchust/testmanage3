import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { RepositoryError } from '@nocobase/db';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z, ZodError } from 'zod';
import { buildTasksServiceToken } from '../providers/build-tasks/index.js';
import { BuildTaskError } from '../providers/build-tasks/model.js';
import type { BuildTasksService } from '../providers/build-tasks/service.js';
type Env = AuthEnv &
  AuthorizationEnv & { Variables: { buildTasks: BuildTasksService } };
function actor(c: Context<Env>) {
  const user = c.get('auth')?.user;
  if (!user?.id) throw new BuildTaskError('FORBIDDEN', 'USER_REQUIRED');
  return {
    id: String(user.id),
    name: String(user.name || user.email || user.id).slice(0, 100),
  };
}
export const buildTaskRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const router = new Hono();
    const routes = new Hono<Env>();
    const service = app.container.resolve(buildTasksServiceToken);
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    routes.use(
      '*',
      auth.required(),
      authz.middleware(),
      bodyLimit({ maxSize: 65536 }),
    );
    const permit =
      (action: string): MiddlewareHandler<Env> =>
      async (c, next) => {
        const decision = await c.get('authz').authorize({
          resource: { type: 'resource', id: 'buildTasks' },
          action,
        });
        const policies =
          decision.conditions?.type === 'resource'
            ? decision.conditions.database
            : undefined;
        if (decision.effect === 'deny' || !policies)
          return c.json({ code: 'FORBIDDEN' }, 403);
        c.set('buildTasks', service.withPolicies(policies));
        await next();
      };
    routes.onError((error, c) => {
      if (error instanceof ZodError || error instanceof SyntaxError)
        return c.json({ code: 'INVALID_INPUT' }, 400);
      if (error instanceof BuildTaskError) {
        const status = {
          INVALID_INPUT: 400,
          NOT_FOUND: 404,
          FORBIDDEN: 403,
          ACTIVE_RUN: 409,
          CONFLICT: 409,
          NOT_CONFIGURED: 503,
          GITHUB_ERROR: 502,
        }[error.code] as 400 | 403 | 404 | 409 | 502 | 503;
        return c.json({ code: error.code, message: error.message }, status);
      }
      if (error instanceof RepositoryError)
        return c.json(
          {
            code: error.code.includes('NOT_FOUND') ? 'NOT_FOUND' : 'FORBIDDEN',
          },
          error.code.includes('NOT_FOUND') ? 404 : 403,
        );
      throw error;
    });
    routes.get('/', permit('read'), async (c) =>
      c.json({
        data: {
          tasks: await c.get('buildTasks').list(),
          ...service.configuration(),
        },
      }),
    );
    routes.post('/', permit('manage'), async (c) =>
      c.json(
        {
          data: await c
            .get('buildTasks')
            .save(null, await c.req.json(), actor(c)),
        },
        201,
      ),
    );
    routes.get('/:id', permit('read'), async (c) =>
      c.json({
        data: {
          ...(await c.get('buildTasks').detail(c.req.param('id'))),
          ...service.configuration(),
        },
      }),
    );
    routes.patch('/:id', permit('manage'), async (c) =>
      c.json({
        data: await c
          .get('buildTasks')
          .save(c.req.param('id'), await c.req.json(), actor(c)),
      }),
    );
    routes.post('/:id/comments', permit('comment'), async (c) => {
      const input = z
        .object({ content: z.string().trim().min(1).max(12000) })
        .strict()
        .parse(await c.req.json());
      return c.json(
        {
          data: await c
            .get('buildTasks')
            .comment(c.req.param('id'), input.content, actor(c)),
        },
        201,
      );
    });
    routes.post('/:id/runs', permit('run'), async (c) => {
      const key = z.string().uuid().parse(c.req.header('Idempotency-Key'));
      return c.json(
        {
          data: await c
            .get('buildTasks')
            .trigger(c.req.param('id'), key, actor(c)),
        },
        202,
      );
    });
    routes.post('/:id/runs/:runId/refresh', permit('run'), async (c) =>
      c.json({
        data: await c
          .get('buildTasks')
          .refresh(c.req.param('id'), c.req.param('runId')),
      }),
    );
    routes.get('/:id/runs/:runId/snapshot', permit('read'), async (c) =>
      c.json({
        data: await c
          .get('buildTasks')
          .snapshot(c.req.param('id'), c.req.param('runId')),
      }),
    );
    router.route('/build-tasks', routes);
    return router;
  });
