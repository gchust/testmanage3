import type { ApplicationServiceProviderConstructor } from '@nocobase/app-server/application';

import TestProgressProvider from './test-progress.js';
import EvaluationsProvider from './evaluations/index.js';
import HttpErrorsProvider from './http-errors.js';

const serviceProviders: readonly ApplicationServiceProviderConstructor[] = [
  HttpErrorsProvider,
  TestProgressProvider,
  EvaluationsProvider,
];

export default serviceProviders;
