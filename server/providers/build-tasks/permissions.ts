import { defineAuthorizationResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization';
const read = (name: string) =>
  defineDatabasePermission((p) => p.collection(name).read('*'));
const tasks = read('buildTasks'),
  comments = read('buildTaskComments'),
  runs = read('buildTaskRuns');
export const buildTasksResource = defineAuthorizationResource(
  'buildTasks',
  (r) =>
    r
      .group('buildTasks')
      .title({ key: 'buildTasks.title', ns: 'app' })
      .action('read', (a) =>
        a
          .title({ key: 'buildTasks.permissions.read', ns: 'app' })
          .grant('tasks', tasks)
          .grant('comments', comments)
          .grant('runs', runs),
      )
      .action('manage', (a) =>
        a
          .title({ key: 'buildTasks.permissions.manage', ns: 'app' })
          .grant('tasks', tasks.create('*').update('*'))
          .grant('comments', comments)
          .grant('runs', runs),
      )
      .action('comment', (a) =>
        a
          .title({ key: 'buildTasks.permissions.comment', ns: 'app' })
          .grant('tasks', tasks)
          .grant('comments', comments.create('*')),
      )
      .action('run', (a) =>
        a
          .title({ key: 'buildTasks.permissions.run', ns: 'app' })
          .grant('tasks', tasks.update(['issueNumber', 'updatedAt']))
          .grant('comments', comments)
          .grant('runs', runs.create('*').update('*')),
      ),
);
