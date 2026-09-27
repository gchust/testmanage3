import { defineSeed } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { problemFixesResource } from '../../../server/providers/problem-fixes/permissions.ts';
export default defineSeed({
  name: '202609270002_seed_problem_fix_permissions',
  transaction: true,
  async run({ query }) {
    const key = 'problem-fix-operator';
    if (
      await query
        .selectFrom('authorizationPermissionSets')
        .select('id')
        .where('key', '=', key)
        .executeTakeFirst()
    )
      return;
    // Not assigned to anyone: each run spends the maintainer's Claude Code quota.
    await query
      .insertInto('authorizationPermissionSets')
      .values({
        id: key,
        key,
        title: encodeAuthorizationTitle({
          key: 'problemFixes.operator',
          ns: 'app',
        }),
        grants: JSON.stringify([
          problemFixesResource.reference().grant({
            read: { runs: 'allRecords' },
            run: { runs: 'allRecords' },
          }),
        ]),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute();
  },
});
