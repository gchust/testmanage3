import { defineMigration, type MigrationDefinition } from '@nocobase/db';

const migration: MigrationDefinition = defineMigration({
  name: '202609250001_create_evaluations',
  async up({ builder }) {
    await builder.createCollection('evaluationBundleFiles', (c) => {
      c.uuid('id').primary().notNull();
      c.string('disk', { length: 255 }).notNull();
      c.text('key').notNull();
      c.text('filename').notNull();
      c.string('ext', { length: 32 }).notNull();
      c.string('mimeType', { length: 255 }).notNull();
      c.bigInt('size').notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
    });
    await builder.createCollection('evaluationSources', (c) => {
      c.string('id', { primaryKey: true, length: 64, nullable: false });
      c.string('apiKeyId', { length: 128, nullable: false });
      c.string('sourceInstance', { length: 255, nullable: false });
      c.string('project', { length: 255, nullable: false });
      c.string('name', { length: 100, nullable: false });
      c.boolean('enabled', { nullable: false, defaultValue: true });
      c.string('createdBy', { length: 64, nullable: false });
      c.datetime('createdAt', { nullable: false });
      c.unique('apiKeyId');
    });
    await builder.createCollection('evaluationReports', (c) => {
      c.string('id', { primaryKey: true, length: 64, nullable: false });
      c.string('sourceInstance', { length: 255, nullable: false });
      c.string('project', { length: 255, nullable: false });
      c.string('type', { length: 32, nullable: false });
      c.string('subjectKey', { length: 300, nullable: false });
      c.integer('revision', { nullable: false });
      c.string('idempotencyKey', { length: 80, nullable: false });
      c.string('bundleFileId', { length: 36, nullable: false });
      c.string('bundleSha256', { length: 64, nullable: false });
      c.string('rank', { length: 300, nullable: false });
      c.text('document', { nullable: false });
      c.text('manifest', { nullable: false });
      c.text('receipt', { nullable: false });
      c.datetime('receivedAt', { nullable: false });
      c.unique('idempotencyKey');
      c.unique(['sourceInstance', 'type', 'subjectKey', 'revision']);
      c.index(['sourceInstance', 'subjectKey']);
    });
    await builder.createCollection('evaluationSubjects', (c) => {
      c.string('id', { primaryKey: true, length: 64, nullable: false });
      c.string('sourceInstance', { length: 255, nullable: false });
      c.string('type', { length: 32, nullable: false });
      c.string('subjectKey', { length: 300, nullable: false });
      c.string('currentReportId', { length: 64, nullable: false });
      c.string('rank', { length: 300, nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.index(['type', 'updatedAt']);
    });
    await builder.createCollection('evaluationMappings', (c) => {
      c.string('id', { primaryKey: true, length: 64, nullable: false });
      c.string('sourceInstance', { length: 255, nullable: false });
      c.string('subjectKey', { length: 300, nullable: false });
      c.integer('featurePointId', { nullable: false });
      c.string('updatedBy', { length: 64, nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.unique(['sourceInstance', 'subjectKey']);
      c.index('featurePointId');
    });
    await builder.createCollection('evaluationFindings', (c) => {
      c.string('id', { primaryKey: true, length: 64, nullable: false });
      c.string('sourceInstance', { length: 255, nullable: false });
      c.string('runKey', { length: 300, nullable: false });
      c.string('findingId', { length: 251, nullable: false });
      c.string('reportId', { length: 64, nullable: false });
      c.text('finding', { nullable: false });
      c.integer('problemId');
      c.string('status', { length: 20, nullable: false, defaultValue: 'new' });
      c.text('note');
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.unique(['sourceInstance', 'runKey', 'findingId']);
      c.index('problemId');
    });
    await builder.createCollection('evaluationRegressions', (c) => {
      c.string('id', { primaryKey: true, length: 64, nullable: false });
      c.integer('problemId', { nullable: false });
      c.string('reportId', { length: 64, nullable: false });
      c.string('verdict', { length: 20, nullable: false });
      c.text('evidenceIds', { nullable: false });
      c.text('note', { nullable: false });
      c.string('createdBy', { length: 64, nullable: false });
      c.datetime('createdAt', { nullable: false });
      c.index('problemId');
    });
    await builder.createCollection('evaluationAudit', (c) => {
      c.string('id', { primaryKey: true, length: 64, nullable: false });
      c.string('actorId', { length: 128, nullable: false });
      c.string('action', { length: 64, nullable: false });
      c.string('target', { length: 300, nullable: false });
      c.text('detail', { nullable: false });
      c.datetime('createdAt', { nullable: false });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('evaluationAudit');
    await builder.dropCollection('evaluationRegressions');
    await builder.dropCollection('evaluationFindings');
    await builder.dropCollection('evaluationMappings');
    await builder.dropCollection('evaluationSubjects');
    await builder.dropCollection('evaluationReports');
    await builder.dropCollection('evaluationSources');
    await builder.dropCollection('evaluationBundleFiles');
  },
});
export default migration;
