import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * The problem timeline: who created the problem and who moved it through its
 * statuses. Actors are stored the same way as comment authors — the Better Auth
 * user id plus a name snapshot — so the history stays readable after a rename.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609220003_create_problem_activities',

  async up({ builder }) {
    await builder.createCollection('problemActivities', (collection) => {
      collection.increments('id');
      collection.integer('problemId', { nullable: false });
      collection.string('actorId', { length: 64 });
      collection.string('actorName', { length: 100, nullable: false });
      // 'created' | 'status' — kept as a string so a later kind needs no migration.
      collection.string('kind', { length: 32, nullable: false });
      collection.string('fromStatus', { length: 16 });
      collection.string('toStatus', { length: 16 });
      collection.datetime('createdAt', { nullable: false });
      collection.index('problemId');
    });
  },

  async down({ builder }) {
    await builder.dropCollection('problemActivities');
  },
});

export default migration;
