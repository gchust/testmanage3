import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  PROBLEM_STATUSES,
  PROBLEM_TYPES,
  TestProgressConflictError,
  TestProgressNotFoundError,
  TestProgressValidationError,
  parseFeaturePointInput,
  parseProblemCommentInput,
  parseProblemInput,
  testProgressServiceToken,
  type ProblemActor,
  type ProblemFilter,
  type ProblemStatus,
  type ProblemType,
} from '../providers/test-progress.js';

function toErrorResponse(context: Context, error: unknown): Response {
  if (error instanceof TestProgressValidationError) {
    return context.json({ code: error.code, message: error.message }, 400);
  }
  if (error instanceof TestProgressNotFoundError) {
    return context.json({ code: error.code, message: error.message }, 404);
  }
  if (error instanceof TestProgressConflictError) {
    return context.json({ code: error.code, message: error.message }, 409);
  }

  throw error;
}

async function respond(
  context: Context,
  action: () => Promise<unknown>,
  status: ContentfulStatusCode = 200,
): Promise<Response> {
  try {
    const data = await action();
    // Serialized directly: Hono's `json()` deeply instantiates its JSON types for
    // an `unknown` payload, which the compiler rejects as excessively deep.
    return new Response(JSON.stringify({ data }), {
      status,
      headers: { 'content-type': 'application/json; charset=UTF-8' },
    });
  } catch (error) {
    return toErrorResponse(context, error);
  }
}

async function respondNoContent(
  context: Context,
  action: () => Promise<void>,
): Promise<Response> {
  try {
    await action();
    return context.body(null, 204);
  } catch (error) {
    return toErrorResponse(context, error);
  }
}

async function readJson(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new TestProgressValidationError('Request body must be valid JSON.');
  }
}

function readIdParam(context: Context, name: string): number {
  const value = Number(context.req.param(name));
  if (!Number.isInteger(value) || value <= 0) {
    throw new TestProgressValidationError(
      `${name} must be a positive integer.`,
    );
  }

  return value;
}

/**
 * The comment author always comes from the session, never from the payload: the
 * authentication middleware put it on the context for the paths this router owns.
 */
function readActor(context: Context): ProblemActor {
  const session = (context as Context<AuthEnv>).get('auth');
  const user = session?.user as
    | { id?: unknown; name?: unknown; username?: unknown }
    | undefined;
  const id = typeof user?.id === 'string' && user.id !== '' ? user.id : null;
  // The display name is what the team reads; the username is the fallback for
  // accounts that never set one.
  const candidates = [user?.name, user?.username];
  const name =
    candidates.find(
      (candidate): candidate is string =>
        typeof candidate === 'string' && candidate.trim() !== '',
    ) ?? 'unknown';

  return { id, name };
}

function readProblemFilter(context: Context): ProblemFilter {
  const filter: {
    featurePointId?: number;
    type?: ProblemType;
    status?: ProblemStatus;
    open?: boolean;
    owner?: string;
    ownerId?: string;
  } = {};

  const featurePointId = context.req.query('featurePointId');
  if (featurePointId !== undefined && featurePointId !== '') {
    const parsed = Number(featurePointId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new TestProgressValidationError(
        'featurePointId must be a positive integer.',
      );
    }
    filter.featurePointId = parsed;
  }

  const type = context.req.query('type');
  if (type !== undefined && type !== '') {
    if (!(PROBLEM_TYPES as readonly string[]).includes(type)) {
      throw new TestProgressValidationError(
        `type must be one of: ${PROBLEM_TYPES.join(', ')}.`,
      );
    }
    filter.type = type as ProblemType;
  }

  const status = context.req.query('status');
  if (status !== undefined && status !== '') {
    if (!(PROBLEM_STATUSES as readonly string[]).includes(status)) {
      throw new TestProgressValidationError(
        `status must be one of: ${PROBLEM_STATUSES.join(', ')}.`,
      );
    }
    filter.status = status as ProblemStatus;
  }

  const open = context.req.query('open');
  if (open === 'true' || open === '1') {
    filter.open = true;
  }

  const owner = context.req.query('owner');
  if (owner !== undefined && owner !== '') {
    filter.owner = owner;
  }

  const ownerId = context.req.query('ownerId');
  if (ownerId !== undefined && ownerId !== '') {
    filter.ownerId = ownerId;
  }

  return filter;
}

export const testProgressApiRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const router = new Hono();
    const auth = app.container.resolve(authenticationToken);
    const service = app.container.resolve(testProgressServiceToken);

    // Identity is the boundary for this internal tracker; the deployment's own
    // permission model can narrow it later without changing the data contract.
    router.use('/test-progress', auth.required());
    router.use('/test-progress/*', auth.required());

    router.get('/test-progress/summary', (context) =>
      respond(context, () => service.getSummary()),
    );

    router.get('/test-progress/feature-points', (context) =>
      respond(context, () => service.listFeaturePoints()),
    );
    router.post('/test-progress/feature-points', (context) =>
      respond(
        context,
        async () =>
          service.createFeaturePoint(
            parseFeaturePointInput(await readJson(context), {
              partial: false,
            }),
          ),
        201,
      ),
    );
    router.get('/test-progress/feature-points/:featurePointId', (context) =>
      respond(context, () =>
        service.getFeaturePoint(readIdParam(context, 'featurePointId')),
      ),
    );
    router.patch('/test-progress/feature-points/:featurePointId', (context) =>
      respond(context, async () =>
        service.updateFeaturePoint(
          readIdParam(context, 'featurePointId'),
          parseFeaturePointInput(await readJson(context), { partial: true }),
        ),
      ),
    );
    router.delete('/test-progress/feature-points/:featurePointId', (context) =>
      respondNoContent(context, () =>
        service.deleteFeaturePoint(readIdParam(context, 'featurePointId')),
      ),
    );

    router.get('/test-progress/members', (context) =>
      respond(context, () => service.listMembers()),
    );

    router.get('/test-progress/problems', (context) =>
      respond(context, () => service.listProblems(readProblemFilter(context))),
    );
    router.get('/test-progress/problems/:problemId', (context) =>
      respond(context, () =>
        service.getProblem(readIdParam(context, 'problemId')),
      ),
    );
    router.post('/test-progress/problems', (context) =>
      respond(
        context,
        async () =>
          service.createProblem(
            parseProblemInput(await readJson(context), { partial: false }),
            readActor(context),
          ),
        201,
      ),
    );
    router.patch('/test-progress/problems/:problemId', (context) =>
      respond(context, async () =>
        service.updateProblem(
          readIdParam(context, 'problemId'),
          parseProblemInput(await readJson(context), { partial: true }),
          readActor(context),
        ),
      ),
    );
    router.delete('/test-progress/problems/:problemId', (context) =>
      respondNoContent(context, () =>
        service.deleteProblem(readIdParam(context, 'problemId')),
      ),
    );

    router.get('/test-progress/problems/:problemId/activities', (context) =>
      respond(context, () =>
        service.listProblemActivities(readIdParam(context, 'problemId')),
      ),
    );
    router.get('/test-progress/problems/:problemId/comments', (context) =>
      respond(context, () =>
        service.listProblemComments(readIdParam(context, 'problemId')),
      ),
    );
    router.post('/test-progress/problems/:problemId/comments', (context) =>
      respond(
        context,
        async () =>
          service.createProblemComment(
            readIdParam(context, 'problemId'),
            parseProblemCommentInput(await readJson(context)),
            readActor(context),
          ),
        201,
      ),
    );
    router.delete(
      '/test-progress/problem-comments/:commentId',
      (context) =>
        respondNoContent(context, () =>
          service.deleteProblemComment(
            readIdParam(context, 'commentId'),
            readActor(context),
          ),
        ),
    );

    return router;
  });
