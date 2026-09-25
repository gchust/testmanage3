import { isAPIError } from 'better-auth/api';
import type { ErrorHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Preserve native auth refusals when deployment packages contain separate APIError constructors. */
export const applicationErrorHandler: ErrorHandler = (error, context) => {
  if (
    isAPIError(error) &&
    Number.isInteger(error.statusCode) &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return context.json(
      error.body ?? { code: error.status, message: error.message },
      error.statusCode as ContentfulStatusCode,
      Object.fromEntries(
        new Headers(error.headers as ConstructorParameters<typeof Headers>[0]),
      ),
    );
  }
  // Keep Hono's HTTPException response and generic-error behavior unchanged.
  if ('getResponse' in error && typeof error.getResponse === 'function') {
    const response = error.getResponse();
    return context.newResponse(response.body, response);
  }
  console.error(error);
  return context.text('Internal Server Error', 500);
};
