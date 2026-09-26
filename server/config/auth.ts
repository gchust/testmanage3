import {
  defineAppConfig,
  type AppConfigFactory,
} from '@nocobase/app-server/config';
import { apiKey } from '@nocobase/app-plugin-api-keys/server';
import type { AuthConfig } from '@nocobase/app-plugin-authentication/server';
import type { BetterAuthPlugin } from 'better-auth';
import { username } from 'better-auth/plugins';
import { APIError, createAuthMiddleware } from 'better-auth/api';

/**
 * Declares `issuer` on Better Auth's core account model.
 *
 * The authentication plugin's migration creates `account.issuer` as NOT NULL and
 * its UserAdministrationService passes `issuer: 'local:credential'` when it creates
 * a credential account. Better Auth 1.7.5 only knows `issuer` inside its
 * generic-oauth plugin, so the adapter silently drops the value and every
 * `POST /api/users` fails with `NOT NULL constraint failed: account.issuer`
 * (the plugin's own seed writes the column directly, which is why the initial
 * admin exists). Declaring the field here keeps the column filled without
 * touching a plugin-owned table. Remove it once the authentication plugin or
 * Better Auth carries the field itself.
 */
const accountIssuer: BetterAuthPlugin = {
  id: 'nocobase-account-issuer',
  schema: {
    account: {
      fields: {
        issuer: { type: 'string', required: false, input: false },
      },
    },
  },
};

const auth: AppConfigFactory<AuthConfig> = defineAppConfig((_runtime) => ({
  plugins: [
    username({ displayUsername: false }),
    apiKey([
      { configId: 'default' },
      { configId: 'evaluation-import', enableSessionForAPIKeys: false },
    ]),
    accountIssuer,
  ],
  hooks: {
    before: createAuthMiddleware(async (context) => {
      // Reserved integration keys can only be managed through the application
      // API, which binds each key to its source. Trusted server calls have no request.
      const body = context.body as { configId?: unknown } | undefined;
      if (
        context.request &&
        context.path.startsWith('/api-key/') &&
        (body?.configId === 'evaluation-import' ||
          context.query?.configId === 'evaluation-import')
      ) {
        throw new APIError('FORBIDDEN', {
          message: 'Use evaluation integration management.',
        });
      }
    }),
  },
  emailAndPassword: { enabled: true, autoSignIn: false },
  session: { storeSessionInDatabase: true },
}));

export default auth;
