import type { Application } from '@nocobase/app-server/application';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { databaseManagerToken } from '@nocobase/db';
import {
  createServiceToken,
  ServiceProvider,
} from '@nocobase/service-provider';
import type { BuildTasksConfig } from '../../config/build-tasks.js';
import { GitHubBuildClient } from './github.js';
import { buildTasksResource } from './permissions.js';
import { BuildTasksService } from './service.js';
export const buildTasksServiceToken =
  createServiceToken<BuildTasksService>('app/build-tasks');
export default class BuildTasksProvider extends ServiceProvider<Application> {
  public readonly name = 'app/build-tasks';
  public override register() {
    this.app.container.singleton(
      buildTasksServiceToken,
      () =>
        new BuildTasksService(
          this.app.container.resolve(databaseManagerToken),
          new GitHubBuildClient(
            this.app.config.get<BuildTasksConfig>('buildTasks')!,
          ),
        ),
    );
  }
  public override async boot() {
    if (!this.app.container.has(authorizationToken)) return;
    const authz = this.app.container.resolve(authorizationToken);
    authz.resourceGroups.add({
      name: 'buildTasks',
      title: { key: 'buildTasks.title', ns: 'app' },
      category: 'business',
    });
    for (const name of ['buildTasks', 'buildTaskComments', 'buildTaskRuns'])
      authz.db.collections.add({ name });
    authz.pages.add({
      name: 'buildTasks',
      title: { key: 'buildTasks.title', ns: 'app' },
      actions: ['access'],
    });
    buildTasksResource.register(authz.resources);
  }
}
