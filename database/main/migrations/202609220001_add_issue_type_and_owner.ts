import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * Missing items and issues became one problem table on 2026-09-22: a material gap
 * is a problem like any other, distinguished by `type`. `issues` is the surviving
 * table, so it gains the type and owner the old `missing_items` rows carried.
 *
 * `missing_items` itself stays in place: the executed seeds that populate it cannot
 * be edited, so dropping it would break a fresh install. It is legacy storage from
 * here on, and `202609220003_seed_merge_missing_items_into_problems` moves its rows
 * into `issues` after those seeds run.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609220001_add_issue_type_and_owner',

  async up({ builder }) {
    await builder.alterCollection('issues', (collection) => {
      collection.string('type', {
        length: 16,
        nullable: false,
        defaultValue: 'manual',
      });
      collection.string('owner', { length: 100 });
      collection.index('type');
    });
  },

  async down({ builder }) {
    await builder.alterCollection('issues', (collection) => {
      collection.dropField('type');
      collection.dropField('owner');
    });
  },
});

export default migration;
