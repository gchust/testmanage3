import { defineMigration, type MigrationDefinition } from '@nocobase/db';

const migration: MigrationDefinition = defineMigration({
  name: '202609270001_create_build_tasks',
  async up({ builder }) {
    await builder.createCollection('buildTasks', (c) => {
      c.string('id', { primaryKey: true, length: 64 });
      c.string('title', { nullable: false, length: 200 });
      c.text('requirements', { nullable: false });
      c.text('acceptanceCriteria', { nullable: false });
      c.string('taskType', { nullable: false, length: 32 });
      c.string('targetBranch', { nullable: false, length: 120 });
      c.boolean('sampleData', { nullable: false });
      c.string('buildReview', { nullable: false, length: 16 });
      c.integer('issueNumber');
      c.string('repository', { nullable: false, length: 255 });
      c.string('createdBy', { nullable: false, length: 64 });
      c.string('createdByName', { nullable: false, length: 100 });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
    });
    await builder.createCollection('buildTaskComments', (c) => {
      c.string('id', { primaryKey: true, length: 64 });
      c.string('taskId', { nullable: false, length: 64 });
      c.string('authorId', { nullable: false, length: 64 });
      c.string('authorName', { nullable: false, length: 100 });
      c.text('content', { nullable: false });
      c.datetime('createdAt', { nullable: false });
      c.index('taskId');
    });
    await builder.createCollection('buildTaskRuns', (c) => {
      c.string('id', { primaryKey: true, length: 64 });
      c.string('taskId', { nullable: false, length: 64 });
      c.string('activeTaskId', { length: 64, unique: true });
      c.string('requestKey', { nullable: false, length: 64 });
      c.string('status', { nullable: false, length: 32 });
      c.text('snapshot', { nullable: false });
      c.string('requestedBy', { nullable: false, length: 64 });
      c.string('requestedByName', { nullable: false, length: 100 });
      c.integer('issueNumber');
      c.string('workflowRunId', { length: 64 });
      c.string('runKey', { length: 400 });
      c.text('error');
      c.text('result');
      c.datetime('dispatchRequestedAt');
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.index('taskId');
      c.index('runKey');
      c.unique(['taskId', 'requestKey']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('buildTaskRuns');
    await builder.dropCollection('buildTaskComments');
    await builder.dropCollection('buildTasks');
  },
});

export default migration;
