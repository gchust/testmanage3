import type { ApplicationServiceProviderConstructor } from '@nocobase/app-server/application';

import TestProgressProvider from './test-progress.js';
import EvaluationsProvider from './evaluations/index.js';
import HttpErrorsProvider from './http-errors.js';
import BuildTasksProvider from './build-tasks/index.js';
import ProblemFixesProvider from './problem-fixes/index.js';

const serviceProviders: readonly ApplicationServiceProviderConstructor[] = [
  HttpErrorsProvider,
  TestProgressProvider,
  EvaluationsProvider,
  BuildTasksProvider,
  ProblemFixesProvider,
];

export default serviceProviders;
