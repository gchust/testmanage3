import { defineSeed } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { buildTasksResource } from '../../../server/providers/build-tasks/permissions.ts';
export default defineSeed({
  name: '202609270001_seed_build_task_permissions',
  transaction: true,
  async run({ query }) {
    const key = 'build-task-operator';
    if (
      await query
        .selectFrom('authorizationPermissionSets')
        .select('id')
        .where('key', '=', key)
        .executeTakeFirst()
    )
      return;
    await query
      .insertInto('authorizationPermissionSets')
      .values({
        id: key,
        key,
        title: encodeAuthorizationTitle({
          key: 'buildTasks.operator',
          ns: 'app',
        }),
        grants: JSON.stringify([
          {
            resource: { type: 'page', id: 'buildTasks' },
            actions: [{ action: 'access' }],
          },
          buildTasksResource.reference().grant({
            read: {
              tasks: 'allRecords',
              comments: 'allRecords',
              runs: 'allRecords',
            },
            manage: {
              tasks: 'allRecords',
              comments: 'allRecords',
              runs: 'allRecords',
            },
            comment: { tasks: 'allRecords', comments: 'allRecords' },
            run: {
              tasks: 'allRecords',
              comments: 'allRecords',
              runs: 'allRecords',
            },
          }),
        ]),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute();
  },
});
