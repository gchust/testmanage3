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
function positive(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) return invalid();
  return n;
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
async function boundedBody(request: Request): Promise<Buffer> {
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
      if (size > LIMITS.zip + 65536) {
        await reader.cancel();
        throw new EvaluationError(
          'TOO_LARGE',
          'Multipart body exceeds 64 MiB plus framing.',
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
      if (!c.req.header('content-type')?.startsWith('multipart/form-data;'))
        return c.json({ code: 'INVALID_MULTIPART' }, 400);
      importing++;
      try {
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
    const allowed = async (
      scope: AuthorizationEnv['Variables']['authz'],
      action: string,
    ): Promise<boolean> =>
      scope.can({ resource: { type: 'resource', id: 'evaluations' }, action });
    secured.use('*', async (c, next) => {
      if (c.req.path.endsWith('/capabilities')) return next();
      const action = c.req.path.includes('/sources')
        ? 'manage'
        : c.req.method === 'GET' && !c.req.path.endsWith('/options')
          ? 'read'
          : 'review';
      const decision = await c.get('authz').authorize({
        resource: { type: 'resource', id: 'evaluations' },
        action,
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
    secured.get('/capabilities', async (c) =>
      respond({
        read: await allowed(c.get('authz'), 'read'),
        review: await allowed(c.get('authz'), 'review'),
        manage: await allowed(c.get('authz'), 'manage'),
      }),
    );
    secured.get('/sources', async (c) =>
      respond(await c.get('evaluation').listSources()),
    );
    secured.post('/sources', async (c) => {
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
    secured.delete('/sources/:id', async (c) => {
      await c
        .get('evaluation')
        .disableSource(text(c.req.param('id'), 64), actor(c));
      return c.body(null, 204);
    });
    secured.get('/reports', async (c) => {
      const type = c.req.query('type') ?? 'evaluation-report';
      if (!['evaluation-report', 'evaluation-batch'].includes(type))
        return invalid();
      const offset = Number(c.req.query('offset') ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000)
        return invalid();
      return respond(await c.get('evaluation').listReports(type, offset));
    });
    secured.get('/reports/:id', async (c) =>
      respond(await c.get('evaluation').getReport(text(c.req.param('id'), 64))),
    );
    secured.get('/reports/:id/history', async (c) =>
      respond(await c.get('evaluation').history(text(c.req.param('id'), 64))),
    );
    secured.get('/reports/:id/findings', async (c) =>
      respond(await c.get('evaluation').findings(text(c.req.param('id'), 64))),
    );
    secured.get('/reports/:id/samples', async (c) =>
      respond(
        await c.get('evaluation').batchSamples(text(c.req.param('id'), 64)),
      ),
    );
    secured.get('/reports/:id/file', async (c) => {
      const file = text(c.req.query('path'), 300);
      const result = await c
        .get('evaluation')
        .attachment(text(c.req.param('id'), 64), file);
      // Untrusted HTML is only downloadable; sandbox and nosniff are defense in depth.
      return new Response(new Uint8Array(result.bytes), {
        headers: {
          'content-type': result.contentType,
          'content-disposition':
            'attachment; filename="' +
            (file.endsWith('.png')
              ? 'evidence.png'
              : file === 'bundle.zip'
                ? 'evaluation-bundle.zip'
                : file === 'report.html'
                  ? 'report.html'
                  : 'evaluation.json') +
            '"',
          'content-security-policy': "sandbox; default-src 'none'",
          'x-content-type-options': 'nosniff',
          'cache-control': 'private, no-store',
        },
      });
    });
    secured.get('/options', async (c) =>
      respond(await c.get('evaluation').trackerOptions()),
    );
    secured.get('/mappings', async (c) =>
      respond(await c.get('evaluation').mappings()),
    );
    secured.get('/modules', async (c) => {
      const offset = Number(c.req.query('offset') ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000)
        return invalid();
      return respond(await c.get('evaluation').modules(offset));
    });
    secured.post('/mappings', async (c) => {
      const input = await json(c);
      const key = text(input.subjectKey);
      if (!/^(pkg:@nocobase\/|guide:|skill:)/.test(key)) return invalid();
      return respond(
        await c.get('evaluation').mapSubject(
          {
            sourceInstance: repo(input.sourceInstance),
            subjectKey: key,
            featurePointId: positive(input.featurePointId),
          },
          actor(c),
        ),
      );
    });
    secured.patch('/findings/:id', async (c) => {
      const body = await json(c),
        input: { problemId?: number | null; status?: string; note?: string } =
          {};
      if ('problemId' in body)
        input.problemId =
          body.problemId === null ? null : positive(body.problemId);
      if ('status' in body) {
        const status = text(body.status, 20);
        if (!['new', 'confirmed', 'ignored'].includes(status)) return invalid();
        input.status = status;
      }
      if ('note' in body) {
        if (typeof body.note !== 'string' || body.note.length > 10000)
          return invalid();
        input.note = body.note;
      }
      return respond(
        await c
          .get('evaluation')
          .updateFinding(text(c.req.param('id'), 64), input, actor(c)),
      );
    });
    secured.get('/regressions', async (c) =>
      respond(
        await c
          .get('evaluation')
          .regressions(
            c.req.query('problemId')
              ? positive(c.req.query('problemId'))
              : undefined,
          ),
      ),
    );
    secured.post('/regressions', async (c) => {
      const body = await json(c),
        verdict = text(body.verdict, 20);
      if (
        !['passed', 'failed', 'inconclusive'].includes(verdict) ||
        !Array.isArray(body.evidenceIds) ||
        body.evidenceIds.length > 200
      )
        return invalid();
      return respond(
        await c.get('evaluation').recordRegression(
          {
            problemId: positive(body.problemId),
            reportId: text(body.reportId, 64),
            verdict,
            note: text(body.note, 10000),
            evidenceIds: body.evidenceIds.map((id) => text(id, 251)),
          },
          actor(c),
        ),
        201,
      );
    });
    secured.get('/compare', async (c) => {
      return respond(
        await c
          .get('evaluation')
          .compare(
            text(c.req.query('left'), 64),
            text(c.req.query('right'), 64),
          ),
      );
    });
    router.route('/evaluations', secured);
    return router;
  });
