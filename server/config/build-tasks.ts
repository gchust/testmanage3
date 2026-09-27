import { defineAppConfig } from '@nocobase/app-server/config';
export interface BuildTasksConfig {
  enabled: boolean;
  repository: string;
  workflow: string;
  ref: string;
  token: string;
}
export default defineAppConfig<BuildTasksConfig>(() => ({
  enabled: false,
  repository: 'gchust/nb3-factory',
  workflow: 'code-agent-task.yml',
  ref: 'develop',
  token: '',
}));
