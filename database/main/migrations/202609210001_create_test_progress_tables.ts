import { defineMigration, type MigrationDefinition } from '@nocobase/db';

const migration: MigrationDefinition = defineMigration({
  name: '202609210001_create_test_progress_tables',

  async up({ builder }) {
    await builder.createCollection('featurePoints', (collection) => {
      collection.increments('id');
      collection.string('name', { length: 200, nullable: false });
      // 'dimension' is one of the five test dimensions, 'feature' a feature point under one.
      collection.string('level', {
        length: 16,
        nullable: false,
        defaultValue: 'feature',
      });
      collection.belongsTo('parent', 'featurePoints', {
        foreignKey: 'parentId',
        foreignKeyType: 'integer',
        targetKey: 'id',
        onDelete: 'set null',
      });
      collection.string('owner', { length: 100 });
      // Test-entry criteria, kept as separate statuses on purpose: whether they add up
      // to "ready for testing" is a human judgement, not a derived verdict.
      collection.string('skillsStatus', {
        length: 16,
        nullable: false,
        defaultValue: 'unspecified',
      });
      collection.string('docsStatus', {
        length: 16,
        nullable: false,
        defaultValue: 'unspecified',
      });
      collection.string('exampleExists', {
        length: 16,
        nullable: false,
        defaultValue: 'unspecified',
      });
      collection.string('exampleFeatureStatus', {
        length: 16,
        nullable: false,
        defaultValue: 'unspecified',
      });
      collection.text('exampleExpected');
      collection.text('exampleCurrent');
      collection.string('status', {
        length: 32,
        nullable: false,
        defaultValue: 'unspecified',
      });
      collection.decimal('designScore', { precision: 4, scale: 1 });
      collection.text('designNote');
      collection.decimal('developmentScore', { precision: 4, scale: 1 });
      collection.text('developmentNote');
      collection.decimal('agentFriendlinessScore', { precision: 4, scale: 1 });
      collection.text('agentFriendlinessNote');
      collection.decimal('outputQualityScore', { precision: 4, scale: 1 });
      collection.text('outputQualityNote');
      collection.text('remark');
      collection.integer('sortOrder', { nullable: false, defaultValue: 0 });
      collection.datetime('createdAt', { nullable: false });
      collection.datetime('updatedAt', { nullable: false });
      collection.index('parentId');
      collection.index('status');
      collection.index('sortOrder');
    });

    await builder.createCollection('missingItems', (collection) => {
      collection.increments('id');
      collection.text('title', { nullable: false });
      collection.belongsTo('featurePoint', 'featurePoints', {
        foreignKey: 'featurePointId',
        foreignKeyType: 'integer',
        targetKey: 'id',
        nullable: false,
        onDelete: 'cascade',
      });
      collection.string('status', {
        length: 16,
        nullable: false,
        defaultValue: 'open',
      });
      collection.string('owner', { length: 100 });
      collection.text('note');
      collection.datetime('createdAt', { nullable: false });
      collection.datetime('updatedAt', { nullable: false });
      collection.index('featurePointId');
      collection.index('status');
    });
  },

  async down({ builder }) {
    await builder.dropCollection('missingItems');
    await builder.dropCollection('featurePoints');
  },
});

export default migration;
