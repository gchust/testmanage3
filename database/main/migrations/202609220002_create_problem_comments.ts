import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * Discussion under one problem. The author is stored as the Better Auth user id
 * plus a name snapshot: identity and credentials belong to Authentication, and a
 * comment must keep reading correctly after a user is renamed or disabled.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609220002_create_problem_comments',

  async up({ builder }) {
    await builder.createCollection('problemComments', (collection) => {
      collection.increments('id');
      collection.integer('problemId', { nullable: false });
      collection.string('authorId', { length: 64 });
      collection.string('authorName', { length: 100, nullable: false });
      collection.text('content', { nullable: false });
      collection.datetime('createdAt', { nullable: false });
      collection.datetime('updatedAt', { nullable: false });
      collection.index('problemId');
    });
  },

  async down({ builder }) {
    await builder.dropCollection('problemComments');
  },
});

export default migration;
