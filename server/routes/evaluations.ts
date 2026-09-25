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
import { Hono, type Context } from 'hono';
import { RepositoryError } from '@nocobase/db';
import { bodyLimit } from 'hono/body-limit';
import { evaluationServiceToken } from '../providers/evaluations/index.js';
import { parseProblemSubmission } from '../providers/evaluations/problems.js';
import { parseLinkedReport } from '../providers/evaluations/report-links.js';
import {
  EvaluationError,
  LIMITS,
  verifyBundle,
} from '../providers/evaluations/protocol.js';

type Env = AuthEnv &
  AuthorizationEnv & {
    Variables: {
      evaluation: import('../providers/evaluations/service.js').EvaluationService;
    };
  };
const invalid = (message = 'Invalid input.'): never => {
  throw new EvaluationError('INVALID_INPUT', message);
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 300): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    return invalid();
  return value.trim();
}
function repo(value: unknown): string {
  const s = text(value, 255);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s)) return invalid();
  return s;
}
async function json(c: Context): Promise<Record<string, unknown>> {
  try {
    return object(await c.req.json());
  } catch {
    return invalid('Expected a JSON object.');
  }
}
function respond(value: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data: value }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
function actor(c: Context<Env>): string {
  const id = c.get('auth')?.user?.id;
  if (!id)
    throw new EvaluationError('FORBIDDEN', 'A user identity is required.');
  return String(id);
}
async function boundedBody(
  request: Request,
  maxSize = LIMITS.zip + 65536,
): Promise<Buffer> {
  const reader = (
    request.body as ReadableStream<Uint8Array> | null
  )?.getReader();
  if (!reader) return invalid('Missing bundle body.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxSize) {
        await reader.cancel();
        throw new EvaluationError(
          'TOO_LARGE',
          'Request body exceeds the delivery format limit.',
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export const evaluationRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const router = new Hono();
    const service = app.container.resolve(evaluationServiceToken);
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    let importing = 0;
    router.onError((error, c) => {
      if (error instanceof EvaluationError) {
        const status = {
          INVALID_BUNDLE: 422,
          CONFLICT: 409,
          FORBIDDEN: 403,
          NOT_FOUND: 404,
          INVALID_INPUT: 400,
          TOO_LARGE: 413,
        }[error.code] as 400 | 403 | 404 | 409 | 413 | 422;
        return c.json({ code: error.code, message: error.message }, status);
      }
      if (error instanceof RepositoryError)
        return c.json(
          {
            code: error.code,
            message: 'Operation is unavailable for these records or fields.',
          },
          error.code.includes('NOT_FOUND') ? 404 : 403,
        );
      throw error;
    });
    // This protocol route uses a non-session API key, bound to a single factory
    // source/project. It does not accept browser cookies or ordinary user API keys.
    router.post('/evaluations/import', async (c) => {
      const apiKey = c.req.header('x-api-key');
      const bearer = c.req.header('authorization');
      if ((apiKey && bearer) || (bearer && !bearer.startsWith('Bearer ')))
        return c.json({ code: 'UNAUTHORIZED' }, 401);
      const source = await service.authenticate(
        apiKey ?? bearer?.slice(7) ?? '',
      );
      if (!source) return c.json({ code: 'UNAUTHORIZED' }, 401);
      if (importing >= 4)
        return c.json({ code: 'BUSY' }, 429, { 'Retry-After': '5' });
      const linked =
        c.req.header('content-type')?.split(';')[0].trim() ===
        'application/json';
      if (
        !linked &&
        !c.req.header('content-type')?.startsWith('multipart/form-data;')
      )
        return c.json({ code: 'INVALID_MULTIPART' }, 400);
      importing++;
      try {
        if (linked) {
          const bytes = await boundedBody(c.req.raw, 4 * 1024 * 1024);
          const input = parseLinkedReport(bytes, {
            version: c.req.header('X-Evaluation-Schema-Version') ?? '',
            type: c.req.header('X-Evaluation-Type') ?? '',
            sha256: c.req.header('X-Evaluation-Bundle-SHA256') ?? '',
            payloadSha256: c.req.header('X-Evaluation-Payload-SHA256') ?? '',
            idempotencyKey: c.req.header('Idempotency-Key') ?? '',
          });
          const result = await service.importLinkedReport(source, input);
          return c.json(result.receipt, result.duplicate ? 200 : 201);
        }
        const bytes = await boundedBody(c.req.raw);
        let form: FormData;
        try {
          form = await new Response(new Uint8Array(bytes), {
            headers: { 'content-type': c.req.header('content-type')! },
          }).formData();
        } catch {
          return c.json({ code: 'INVALID_MULTIPART' }, 400);
        }
        const entries = [...form.entries()];
        if (
          entries.length < 1 ||
          entries.length > 2 ||
          entries.some(([key]) => !['bundle', 'problems'].includes(key)) ||
          form.getAll('bundle').length !== 1 ||
          form.getAll('problems').length > 1 ||
          typeof form.get('bundle') === 'string' ||
          !form.get('bundle')
        )
          return c.json({ code: 'INVALID_MULTIPART' }, 400);
        const file = form.get('bundle') as File;
        if (file.type !== 'application/zip')
          return c.json({ code: 'INVALID_MULTIPART' }, 400);
        if (file.size > LIMITS.zip)
          throw new EvaluationError('TOO_LARGE', 'Bundle exceeds 64 MiB.');
        const zip = Buffer.from(await file.arrayBuffer());
        const verified = verifyBundle(zip, {
          sha256: c.req.header('X-Evaluation-Bundle-SHA256') ?? '',
          idempotencyKey: c.req.header('Idempotency-Key') ?? '',
          type: c.req.header('X-Evaluation-Type') ?? '',
          version: c.req.header('X-Evaluation-Schema-Version') ?? '',
        });
        let problems;
        const submission = form.get('problems');
        if (submission !== null) {
          if (
            typeof submission !== 'string' ||
            Buffer.byteLength(submission) > 1024 * 1024
          )
            return c.json({ code: 'INVALID_MULTIPART' }, 400);
          let value: unknown;
          try {
            value = JSON.parse(submission);
          } catch {
            return c.json({ code: 'INVALID_INPUT' }, 400);
          }
          problems = parseProblemSubmission(value, verified.document);
        }
        const result = await service.importBundle(
          source,
          zip,
          verified,
          problems,
        );
        // The factory requires a top-level receipt, without the application's data envelope.
        return new Response(JSON.stringify(result.receipt), {
          status: result.duplicate ? 200 : 201,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      } finally {
        importing--;
      }
    });
    const secured = new Hono<Env>();
    secured.use(
      '*',
      auth.required(),
      authz.middleware(),
      bodyLimit({ maxSize: 65536 }),
    );
    // Integration administration is the only staff surface retained here.
    // Keep the deployed resource id so existing manager grants remain valid.
    secured.use('*', async (c, next) => {
      const decision = await c.get('authz').authorize({
        resource: { type: 'resource', id: 'evaluations' },
        action: 'manage',
      });
      const policies =
        decision.conditions?.type === 'resource'
          ? decision.conditions.database
          : undefined;
      if (decision.effect === 'deny' || !policies)
        return c.json({ code: 'FORBIDDEN' }, 403);
      c.set('evaluation', service.withPolicies(policies));
      await next();
    });
    secured.get('/', async (c) =>
      respond(await c.get('evaluation').listSources()),
    );
    secured.post('/', async (c) => {
      const input = await json(c);
      return respond(
        await c.get('evaluation').createSource(
          {
            name: text(input.name, 100),
            sourceInstance: repo(input.sourceInstance),
            project: repo(input.project),
          },
          actor(c),
        ),
        201,
      );
    });
    secured.delete('/:id', async (c) => {
      await c
        .get('evaluation')
        .disableSource(text(c.req.param('id'), 64), actor(c));
      return c.body(null, 204);
    });
    router.route('/evaluations/sources', secured);
    // Unknown integration paths must not fall through to the application's SPA.
    router.all('/evaluations/*', (c) => c.json({ code: 'NOT_FOUND' }, 404));
    return router;
  });
