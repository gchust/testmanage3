import { defineAuthorizationResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization';
const runs = defineDatabasePermission((p) =>
  p.collection('problemFixRuns').read('*'),
);
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
