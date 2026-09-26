import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';

import { apiGuideRoutes } from './api-guide.js';
import problemFileRoutes from './files.js';
import { testProgressApiRoutes } from './test-progress.js';
import { evaluationRoutes } from './evaluations.js';

const routes: readonly AppRouteContribution<Application>[] = [
  testProgressApiRoutes,
  evaluationRoutes,
  apiGuideRoutes,
  ...problemFileRoutes,
];

export default routes;
