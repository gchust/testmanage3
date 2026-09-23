import type { ApplicationServiceProviderConstructor } from '@nocobase/app-server/application';

import TestProgressProvider from './test-progress.js';

const serviceProviders: readonly ApplicationServiceProviderConstructor[] = [
  TestProgressProvider,
];

export default serviceProviders;
