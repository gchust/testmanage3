import { defineMigration, type MigrationDefinition } from '@nocobase/db';

const migration: MigrationDefinition = defineMigration({
  name: '202609250003_reference_factory_reports',
  async up({ builder }) {
    await builder.alterCollection('evaluationReports', (collection) => {
      collection.alterField('bundleFileId', {
        type: 'string',
        length: 36,
        nullable: true,
      });
      collection.string('reportUrl', { length: 2048, nullable: true });
    });
  },
  async down({ builder, query }) {
    const linked = await query
      .selectFrom('evaluationReports')
      .select('id')
      .where('bundleFileId', 'is', null)
      .executeTakeFirst();
    if (linked)
      throw new Error(
        'Archive linked reports before rolling back report-link support.',
      );
    await builder.alterCollection('evaluationReports', (collection) => {
      collection.dropField('reportUrl');
      collection.alterField('bundleFileId', {
        type: 'string',
        length: 36,
        nullable: false,
      });
    });
  },
});

export default migration;
