import { defineAppConfig } from '@nocobase/app-server/config';
export interface ProblemFixesConfig {
  enabled: boolean;
  repository: string;
  workflow: string;
  ref: string;
  /** Empty falls back to `buildTasks.token`, the credential already scoped to the factory. */
  token: string;
}
export default defineAppConfig<ProblemFixesConfig>(() => ({
  enabled: false,
  repository: 'gchust/nb3-factory',
  workflow: 'framework-fix.yml',
  ref: 'develop',
  token: '',
}));
