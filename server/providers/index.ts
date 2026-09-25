import type { ApplicationServiceProviderConstructor } from '@nocobase/app-server/application';

import TestProgressProvider from './test-progress.js';
import EvaluationsProvider from './evaluations/index.js';

const serviceProviders: readonly ApplicationServiceProviderConstructor[] = [
  TestProgressProvider,
  EvaluationsProvider,
];

export default serviceProviders;
