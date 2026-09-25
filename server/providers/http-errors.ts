import type { Application } from '@nocobase/app-server/application';
import { ServiceProvider } from '@nocobase/service-provider';
import { applicationErrorHandler } from '../http-error-handler.js';

export default class HttpErrorsProvider extends ServiceProvider<Application> {
  public readonly name = 'app/http-errors';

  public override async boot(): Promise<void> {
    // Resolve the native router after registration, before routes are mounted.
    this.app.router.onError(applicationErrorHandler);
  }
}
