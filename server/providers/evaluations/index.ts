import type { Application } from '@nocobase/app-server/application';
import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { ApiKeyService } from '@nocobase/app-plugin-api-keys/server';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { databaseManagerToken } from '@nocobase/db';
import {
  createServiceToken,
  ServiceProvider,
} from '@nocobase/service-provider';
import { driveManagerToken } from '@nocobase/app-server/drive';
import { serverFileRepositoryManagerToken } from '@nocobase/app-plugin-file/server';
import { EvaluationArchive } from './archive.js';
import { factoryIntegrationResource } from './permissions.js';
import { EvaluationService } from './service.js';

export const evaluationServiceToken =
  createServiceToken<EvaluationService>('app/evaluations');
export default class EvaluationsProvider extends ServiceProvider<Application> {
  public readonly name = 'app/evaluations';
  public override register(): void {
    this.app.container.singleton(
      evaluationServiceToken,
      () =>
        new EvaluationService(
          this.app.container.resolve(databaseManagerToken),
          new EvaluationArchive(
            this.app.container.resolve(serverFileRepositoryManagerToken),
            this.app.container.resolve(driveManagerToken),
          ),
          new ApiKeyService(
            this.app.container.resolve(authenticationToken),
            'evaluation-import',
          ),
        ),
    );
  }
  public override async boot(): Promise<void> {
    if (!this.app.container.has(authorizationToken)) return;
    const authz = this.app.container.resolve(authorizationToken);
    authz.resourceGroups.add({
      name: 'factoryIntegration',
      title: { key: 'factoryIntegration.title', ns: 'app' },
      category: 'business',
    });
    for (const name of [
      'evaluationReports',
      'evaluationSources',
      'evaluationAudit',
      'evaluationBundleFiles',
    ])
      authz.db.collections.add({ name });
    factoryIntegrationResource.register(authz.resources);
  }
}
