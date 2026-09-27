import type { Application } from '@nocobase/app-server/application';
import type { AppIdentityConfig } from '@nocobase/app-server/config';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { databaseManagerToken } from '@nocobase/db';
import {
  createServiceToken,
  ServiceProvider,
} from '@nocobase/service-provider';
import type { BuildTasksConfig } from '../../config/build-tasks.js';
import type { ProblemFixesConfig } from '../../config/problem-fixes.js';
import { testProgressServiceToken } from '../test-progress.js';
import { ProblemFixGitHubClient } from './github.js';
import { problemFixesResource } from './permissions.js';
import { ProblemFixesService } from './service.js';
export const problemFixesServiceToken =
  createServiceToken<ProblemFixesService>('app/problem-fixes');
export default class ProblemFixesProvider extends ServiceProvider<Application> {
  public readonly name = 'app/problem-fixes';
  public override register() {
    this.app.container.singleton(problemFixesServiceToken, () => {
      const config = this.app.config.get<ProblemFixesConfig>('problemFixes')!;
      const identity = this.app.config.get<AppIdentityConfig>('app');
      return new ProblemFixesService(
        this.app.container.resolve(databaseManagerToken),
        new ProblemFixGitHubClient({
          ...config,
          // One factory credential serves both integrations unless overridden.
          token:
            config.token ||
            this.app.config.get<BuildTasksConfig>('buildTasks')?.token ||
            '',
        }),
        this.app.container.resolve(testProgressServiceToken),
        {
          publicOrigin: identity?.publicOrigin,
          publicBasePath: identity?.publicBasePath ?? '/main',
        },
      );
    });
  }
  public override async boot() {
    if (!this.app.container.has(authorizationToken)) return;
    const authz = this.app.container.resolve(authorizationToken);
    authz.resourceGroups.add({
      name: 'problemFixes',
      title: { key: 'problemFixes.title', ns: 'app' },
      category: 'business',
    });
    authz.db.collections.add({ name: 'problemFixRuns' });
    problemFixesResource.register(authz.resources);
  }
}
