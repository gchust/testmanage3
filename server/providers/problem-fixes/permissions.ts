import { defineAuthorizationResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization';
const runs = defineDatabasePermission((p) =>
  p.collection('problemFixRuns').read('*'),
);
// Frozen dependency of the already-deployed 202609270002 seed: the grants it
// stores name exactly these actions and grant keys, and an executed seed cannot
// change. Change permissions through `registeredProblemFixesResource`, with a new
// seed or migration for the grants already stored.
export const problemFixesResource = defineAuthorizationResource(
  'problemFixes',
  (r) =>
    r
      .group('problemFixes')
      .title({ key: 'problemFixes.title', ns: 'app' })
      .action('read', (a) =>
        a
          .title({ key: 'problemFixes.permissions.read', ns: 'app' })
          .grant('runs', runs),
      )
      .action('run', (a) =>
        a
          .title({ key: 'problemFixes.permissions.run', ns: 'app' })
          .grant('runs', runs.create('*').update('*')),
      ),
);

/** The resource the running application registers; identical to the seed's today. */
export const registeredProblemFixesResource = problemFixesResource;
