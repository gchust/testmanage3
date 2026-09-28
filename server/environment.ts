import {
  envString,
  envBoolean,
  envInteger,
  type EnvironmentMapping,
} from '@nocobase/config/providers/env';

export const environmentMappings: Readonly<Record<string, EnvironmentMapping>> =
  {
    // Secrets
    AUTH_SECRET: envString('auth.secret'),
    SESSION_SECRET: envString('session.secret'),
    FACTORY_GITHUB_TOKEN: envString('buildTasks.token'),
    FACTORY_BUILDS_ENABLED: envBoolean('buildTasks.enabled'),
    PROBLEM_FIXES_GITHUB_TOKEN: envString('problemFixes.token'),
    PROBLEM_FIXES_ENABLED: envBoolean('problemFixes.enabled'),
    FACTORY_PREVIEW_DOMAIN: envString('factoryPreview.domain'),

    // Deployment
    APP_SERVER_HOST: envString('server.host'),
    APP_SERVER_PORT: envInteger('server.port'),
    APP_SERVER_START_LOG: envBoolean('server.startLog'),
    APP_PUBLIC_ORIGIN: envString('app.publicOrigin'),
    APP_DEFAULT_LOCALE: envString('i18n.defaultLocale'),
    SNOWFLAKE_WORKER_ID: envInteger('snowflake.workerId'),

    // Development server
    APP_VITE_DEV_URL: {
      path: 'spa.viteDevUrl',
      parse: (value): string | null =>
        value === 'false' || value === '0' ? null : value,
    },
  };
