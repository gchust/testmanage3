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
import { evaluationServiceToken } from '../providers/evaluations/index.js';
import { problemFixesServiceToken } from '../providers/problem-fixes/index.js';
import {
  claimInput,
  ProblemFixError,
  resultInput,
} from '../providers/problem-fixes/model.js';
import type {
  FixSource,
  ProblemFixesService,
} from '../providers/problem-fixes/service.js';

type StaffEnv = AuthEnv &
  AuthorizationEnv & { Variables: { problemFixes: ProblemFixesService } };
type FactoryEnv = { Variables: { source: FixSource } };
const problemId = (c: Context) =>
  z.coerce.number().int().positive().parse(c.req.param('problemId'));
function actor(c: Context<StaffEnv>) {
  const user = c.get('auth')?.user;
  if (!user?.id) throw new ProblemFixError('FORBIDDEN', 'USER_REQUIRED');
  return {
    id: String(user.id),
    name: String(user.name || user.email || user.id).slice(0, 100),
  };
}

export const problemFixRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const router = new Hono();
    const root = new Hono();
    const service = app.container.resolve(problemFixesServiceToken);
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    root.onError((error, c) => {
      if (error instanceof ZodError || error instanceof SyntaxError)
        return c.json({ code: 'INVALID_INPUT' }, 400);
      if (error instanceof ProblemFixError) {
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

    // Staff: signed-in users with the problemFixes resource permission.
    const staff = new Hono<StaffEnv>();
    staff.use(
      '*',
      auth.required(),
      authz.middleware(),
      bodyLimit({ maxSize: 65536 }),
    );
    const permit =
      (action: string): MiddlewareHandler<StaffEnv> =>
      async (c, next) => {
        const decision = await c.get('authz').authorize({
          resource: { type: 'resource', id: 'problemFixes' },
          action,
        });
        const policies =
          decision.conditions?.type === 'resource'
            ? decision.conditions.database
            : undefined;
        if (decision.effect === 'deny' || !policies)
          return c.json({ code: 'FORBIDDEN' }, 403);
        c.set('problemFixes', service.withPolicies(policies));
        await next();
      };
    staff.get('/:problemId/runs', permit('read'), async (c) =>
      c.json({
        data: {
          runs: await c.get('problemFixes').list(problemId(c)),
          ...service.configuration(),
        },
      }),
    );
    staff.post('/:problemId/runs', permit('run'), async (c) => {
      const key = z.string().uuid().parse(c.req.header('Idempotency-Key'));
      return c.json(
        {
          data: await c
            .get('problemFixes')
            .trigger(problemId(c), key, actor(c)),
        },
        202,
      );
    });
    staff.post('/:problemId/runs/:runId/refresh', permit('run'), async (c) =>
      c.json({
        data: await c
          .get('problemFixes')
          .refresh(problemId(c), z.string().uuid().parse(c.req.param('runId'))),
      }),
    );

    // Factory: the source-bound integration key /evaluations/import accepts.
    // Browser sessions and ordinary user API keys are not accepted here.
    const factory = new Hono<FactoryEnv>();
    factory.use('*', bodyLimit({ maxSize: 262144 }), async (c, next) => {
      const apiKey = c.req.header('x-api-key');
      const bearer = c.req.header('authorization');
      if ((apiKey && bearer) || (bearer && !bearer.startsWith('Bearer ')))
        return c.json({ code: 'UNAUTHORIZED' }, 401);
      const source = await app.container
        .resolve(evaluationServiceToken)
        .authenticate(apiKey ?? bearer?.slice(7) ?? '');
      if (!source) return c.json({ code: 'UNAUTHORIZED' }, 401);
      // 503 while fixes are disabled, 403 for another repository's key.
      service.authorizeSource(source);
      c.set('source', source);
      await next();
    });
    factory.post('/claims', async (c) => {
      const { created, ...claim } = await service.claim(
        c.get('source'),
        claimInput.parse(await c.req.json()),
      );
      return c.json({ data: claim }, created ? 201 : 200);
    });
    factory.post('/runs/:runId/result', async (c) =>
      c.json({
        data: await service.report(
          c.get('source'),
          z.string().uuid().parse(c.req.param('runId')),
          resultInput.parse(await c.req.json()),
        ),
      }),
    );

    root.route('/problems', staff);
    root.route('/factory', factory);
    // Unknown integration paths must not fall through to the application's SPA.
    root.all('*', (c) => c.json({ code: 'NOT_FOUND' }, 404));
    router.route('/problem-fixes', root);
    return router;
  });
