import { defineAppConfig } from '@nocobase/app-server/config';

/**
 * Where the factory's pull request previews live. Only a report the factory
 * `repository` produced for its own pull request gets a preview link, following
 * the factory's documented address rule `https://nb3-<PR>.<domain>/main/`. A
 * link is not a claim that the preview is running. An empty repository turns
 * preview links off.
 */
export interface FactoryPreviewConfig {
  repository: string;
  domain: string;
}

export default defineAppConfig<FactoryPreviewConfig>(() => ({
  repository: 'gchust/nb3-factory',
  domain: 'nfvd.net',
}));
