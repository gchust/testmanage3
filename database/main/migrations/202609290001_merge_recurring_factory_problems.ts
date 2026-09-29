import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * Every build of a task is a new factory run, so a problem the task keeps hitting
 * arrived with a new key each time and was collected again. The factory now sends
 * the task (`factoryTask`, scoped to its source) and a per-task `fingerprint`; a
 * later run's problem is recorded as an occurrence of the problem already
 * collected instead of a copy, when its fingerprint is known or when the factory's
 * model judged it a duplicate of one of the task's problems.
 *
 * `factoryProblemOccurrences` maps each later run's scoped key to that problem, so
 * retries and replays of the later run stay idempotent the way `factoryKey` makes
 * the first run's. Its `fingerprint` is the later wording, so the next run that
 * words the problem the same way merges without asking the model again.
 * `problemActivities.note` keeps the model's reason on the timeline.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609290001_merge_recurring_factory_problems',
  async up({ builder }) {
    await builder.alterCollection('issues', (collection) => {
      collection.string('factoryFingerprint', { length: 64 });
      collection.string('factoryTask', { length: 300 });
      collection.index('factoryFingerprint');
      collection.index('factoryTask');
    });
    await builder.createCollection(
      'factoryProblemOccurrences',
      (collection) => {
        collection.increments('id');
        collection.string('factoryKey', { length: 64, nullable: false });
        collection.string('fingerprint', { length: 64 });
        collection.integer('problemId', { nullable: false });
        collection.string('reportId', { length: 64, nullable: false });
        collection.datetime('createdAt', { nullable: false });
        collection.unique('factoryKey');
        collection.index('fingerprint');
        collection.index('problemId');
      },
    );
    await builder.alterCollection('problemActivities', (collection) => {
      collection.text('note');
    });
  },
  async down({ builder }) {
    await builder.alterCollection('problemActivities', (collection) => {
      collection.dropField('note');
    });
    await builder.dropCollection('factoryProblemOccurrences');
    await builder.alterCollection('issues', (collection) => {
      collection.dropField('factoryFingerprint');
      collection.dropField('factoryTask');
    });
  },
});

export default migration;
