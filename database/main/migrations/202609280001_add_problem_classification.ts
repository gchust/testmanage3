import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * Where a problem's feature point came from. The factory classifies problems before
 * delivery ('rule' or 'model', with its reason in the note, including a reason for
 * leaving one unclassified); a person changing the feature point marks it 'manual'.
 * Only a problem with no feature point and no source is ever classified automatically.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609280001_add_problem_classification',
  async up({ builder }) {
    await builder.alterCollection('issues', (collection) => {
      collection.string('classificationSource', { length: 16 });
      collection.text('classificationNote');
    });
  },
  async down({ builder }) {
    await builder.alterCollection('issues', (collection) => {
      collection.dropField('classificationSource');
      collection.dropField('classificationNote');
    });
  },
});

export default migration;
