import { defineMigration, type MigrationDefinition } from '@nocobase/db';

const migration: MigrationDefinition = defineMigration({
  name: '202609270002_create_problem_fix_runs',
  async up({ builder }) {
    await builder.createCollection('problemFixRuns', (c) => {
      c.string('id', { primaryKey: true, length: 64 });
      c.integer('problemId', { nullable: false });
      // The admission lock: one active Claude Code fix per problem.
      c.integer('activeProblemId', { unique: true });
      // Staff clicks carry a key; runs registered by a manual GitHub dispatch do not.
      c.string('requestKey', { length: 64 });
      c.string('origin', { nullable: false, length: 16 });
      c.string('repository', { nullable: false, length: 255 });
      c.string('status', { nullable: false, length: 32 });
      c.text('snapshot', { nullable: false });
      c.string('requestedBy', { nullable: false, length: 64 });
      c.string('requestedByName', { nullable: false, length: 100 });
      c.string('workflowRunId', { length: 64 });
      c.datetime('dispatchRequestedAt');
      c.text('result');
      c.text('error');
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.index('problemId');
      c.unique(['problemId', 'requestKey']);
      c.unique(['repository', 'workflowRunId']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('problemFixRuns');
  },
});

export default migration;
