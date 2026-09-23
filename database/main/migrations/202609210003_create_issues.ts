import { defineMigration, type MigrationDefinition } from '@nocobase/db';

const migration: MigrationDefinition = defineMigration({
  name: '202609210003_create_issues',

  async up({ builder }) {
    await builder.createCollection('issues', (collection) => {
      collection.increments('id');
      collection.string('title', { length: 200, nullable: false });
      collection.text('description');
      collection.belongsTo('featurePoint', 'featurePoints', {
        foreignKey: 'featurePointId',
        foreignKeyType: 'integer',
        targetKey: 'id',
        nullable: false,
        onDelete: 'cascade',
      });
      // pending (待确认) -> fixing (修复中) -> regression (待回归) -> verified (回归完成)
      collection.string('status', {
        length: 16,
        nullable: false,
        defaultValue: 'pending',
      });
      collection.datetime('createdAt', { nullable: false });
      collection.datetime('updatedAt', { nullable: false });
      collection.index('featurePointId');
      collection.index('status');
    });
  },

  async down({ builder }) {
    await builder.dropCollection('issues');
  },
});

export default migration;
