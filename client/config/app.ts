import { defineAppConfig, type AppConfigFactory } from '@nocobase/app-client';

/**
 * The application starts in the Ocean preset. A valid browser-local choice still
 * wins, and a deployment can override both defaults in `config.yml`.
 */
const app: AppConfigFactory<{
  title: string;
  defaultColorScheme?: string;
  defaultTheme?: string;
}> = defineAppConfig((_runtime) => ({
  title: 'Test Manager',
  defaultTheme: 'ocean',
}));
export default app;
