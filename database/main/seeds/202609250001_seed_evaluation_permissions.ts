import { defineSeed } from '@nocobase/db';
import { evaluationResource } from '../../../server/providers/evaluations/permissions.ts';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';

export default defineSeed({
  name: '202609250001_seed_evaluation_permissions',
  transaction: true,
  async run({ query }) {
    // New business roles only. Preserve existing roles and administrator assignments.
    for (const key of [
      'evaluation-reader',
      'evaluation-reviewer',
      'evaluation-manager',
    ] as const) {
      if (
        await query
          .selectFrom('authorizationPermissionSets')
          .select('id')
          .where('key', '=', key)
          .executeTakeFirst()
      )
        continue;
      await query
        .insertInto('authorizationPermissionSets')
        .values({
          id: key,
          key,
          title: encodeAuthorizationTitle({
            key: 'evaluations.roles.' + key,
            ns: 'app',
          }),
          grants: JSON.stringify([
            {
              resource: { type: 'page', id: 'evaluations' },
              actions: [{ action: 'access' }],
            },
            evaluationResource.reference().grant({
              read: {
                reports: 'allRecords',
                subjects: 'allRecords',
                findings: 'allRecords',
                mappings: 'allRecords',
                regressions: 'allRecords',
              },
            }),
            ...(key === 'evaluation-reader'
              ? []
              : [
                  evaluationResource.reference().grant({
                    review: {
                      reports: 'allRecords',
                      subjects: 'allRecords',
                      findings: 'allRecords',
                      mappings: 'allRecords',
                      regressions: 'allRecords',
                      features: 'allRecords',
                      problems: 'allRecords',
                      audit: 'allRecords',
                    },
                  }),
                ]),
            ...(key !== 'evaluation-manager'
              ? []
              : [
                  evaluationResource.reference().grant({
                    manage: { sources: 'allRecords', audit: 'allRecords' },
                  }),
                ]),
          ]),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .execute();
    }
  },
});
