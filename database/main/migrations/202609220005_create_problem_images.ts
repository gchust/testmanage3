import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * Images pasted into a problem description or comment.
 *
 * Uploaded through the File plugin's repository, which owns the fixed column set:
 * id/disk/key/filename/ext/mimeType/size plus timestamps. Rows stand alone — a
 * Markdown body references the image by its content URL, so no relation column is
 * needed.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609220005_create_problem_images',

  async up({ builder }) {
    await builder.createCollection('problem_images', (collection) => {
      collection.uuid('id').primary().notNull();
      collection.string('disk', { length: 255 }).notNull();
      collection.text('key').notNull();
      collection.text('filename').notNull();
      collection.string('ext', { length: 32 }).notNull();
      collection.string('mimeType', { length: 255 }).notNull();
      collection.bigInt('size').notNull();
      collection.datetime('createdAt').notNull();
      collection.datetime('updatedAt').notNull();
    });
  },

  async down({ builder }) {
    await builder.dropCollection('problem_images');
  },
});

export default migration;
