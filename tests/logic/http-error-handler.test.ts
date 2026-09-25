// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { APIError } from 'better-auth/api';
import { applicationErrorHandler } from '../../server/http-error-handler.js';

afterEach(() => vi.restoreAllMocks());

function request(error: Error) {
  const app = new Hono();
  app.onError(applicationErrorHandler);
  app.get('/', () => {
    throw error;
  });
  return app.request('/');
}

describe('deployed authentication error boundary', () => {
  it('retains native 401 responses across separate package constructors', async () => {
    const native = new APIError('UNAUTHORIZED', {
      code: 'INVALID_API_KEY',
      message: 'Invalid API key.',
    });
    // Dist installs can contain a second copy of Better Auth: same public
    // error contract, but no shared class identity with the App dependency.
    const foreign = Object.assign(new Error(native.message), native);
    expect(foreign).not.toBeInstanceOf(APIError);
    const response = await request(foreign);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(native.body);
  });

  it('preserves rate-limit status and retry headers', async () => {
    const response = await request(
      new APIError(
        'TOO_MANY_REQUESTS',
        { code: 'USAGE_EXCEEDED' },
        { 'retry-after': '5' },
      ),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('5');
  });

  it('preserves Hono exceptions and does not expose unknown server errors', async () => {
    expect((await request(new HTTPException(404))).status).toBe(404);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await request(new Error('private implementation detail'));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
    expect(logged).toHaveBeenCalledOnce();
  });
});
