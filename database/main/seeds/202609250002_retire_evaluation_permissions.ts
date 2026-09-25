import { defineSeed } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';

// The original seed is deployed history. Retire its removed capabilities here,
// preserving custom grants, titles and the existing integration manager identity.
export default defineSeed({
  name: '202609250002_retire_evaluation_permissions',
  transaction: true,
  async run({ query }) {
    const sets = await query
      .selectFrom('authorizationPermissionSets')
      .selectAll()
      .execute();
    for (const set of sets) {
      const original = JSON.parse(String(set.grants)) as Array<{
        resource: { type: string; id: string };
        actions: Array<{ action: string }>;
      }>;
      const grants = original.flatMap((grant) => {
        if (
          grant.resource.type === 'page' &&
          grant.resource.id === 'evaluations'
        )
          return [];
        if (
          grant.resource.type !== 'resource' ||
          grant.resource.id !== 'evaluations'
        )
          return [grant];
        const actions = grant.actions.filter(
          ({ action }) => !['read', 'review'].includes(action),
        );
        return actions.length ? [{ ...grant, actions }] : [];
      });
      if (
        !grants.length &&
        ['evaluation-reader', 'evaluation-reviewer'].includes(String(set.key))
      ) {
        await query
          .deleteFrom('authorizationPermissionSetAssignments')
          .where('permissionSetKey', '=', String(set.key))
          .execute();
        await query
          .deleteFrom('authorizationPermissionSets')
          .where('id', '=', String(set.id))
          .execute();
        continue;
      }
      const originalManagerTitle = encodeAuthorizationTitle({
        key: 'evaluations.roles.evaluation-manager',
        ns: 'app',
      });
      const title =
        set.key === 'evaluation-manager' && set.title === originalManagerTitle
          ? encodeAuthorizationTitle({
              key: 'factoryIntegration.manager',
              ns: 'app',
            })
          : set.title;
      if (
        JSON.stringify(grants) !== JSON.stringify(original) ||
        title !== set.title
      ) {
        await query
          .updateTable('authorizationPermissionSets')
          .set({ grants: JSON.stringify(grants), title, updatedAt: new Date() })
          .where('id', '=', String(set.id))
          .execute();
      }
    }
  },
});
