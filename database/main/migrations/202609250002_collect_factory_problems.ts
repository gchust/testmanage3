import { defineMigration, type MigrationDefinition } from '@nocobase/db';

const migration: MigrationDefinition = defineMigration({
  name: '202609250002_collect_factory_problems',
  async up({ builder }) {
    await builder.alterCollection('issues', (c) => {
      // Incoming findings may not have a human module mapping yet. Do not invent
      // a feature point or discard the problem while it waits for classification.
      c.alterField('featurePointId', { type: 'integer', nullable: true });
      c.string('factoryKey', { length: 64 });
      c.string('factoryReportId', { length: 64 });
      c.unique('factoryKey');
    });
  },
  async down({ builder, query }) {
    if (
      await query
        .selectFrom('issues')
        .select('id')
        .where('featurePointId', 'is', null)
        .executeTakeFirst()
    ) {
      throw new Error(
        'Classify all uncategorized problems before reverting factory collection.',
      );
    }
    await builder.alterCollection('issues', (c) => {
      c.dropField('factoryKey');
      c.dropField('factoryReportId');
      c.alterField('featurePointId', { type: 'integer', nullable: false });
    });
  },
});
export default migration;
