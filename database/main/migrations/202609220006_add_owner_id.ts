import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * Owners become account associations: `ownerId` stores `users.id` and the service
 * resolves the display name from the account for reads. It is a plain string
 * column rather than a declared relation on purpose: application migrations must
 * run without the Users plugin loaded (the runtime composition test boots with no
 * plugins), and a relation to a plugin-provided collection fails validation there.
 *
 * The legacy `owner` text column stays in place because executed seeds write owner
 * names into it and cannot be edited; the service keeps the text in sync as a
 * display fallback for environments where the accounts do not exist yet.
 *
 * The backfill that maps existing owner names to account ids is
 * `202609220008_seed_backfill_owner_ids`, which runs after the snapshot seed.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609220006_add_owner_id',

  async up({ builder }) {
    await builder.alterCollection('featurePoints', (collection) => {
      collection.string('ownerId', { length: 64 });
    });
    await builder.alterCollection('issues', (collection) => {
      collection.string('ownerId', { length: 64 });
    });
  },

  async down({ builder }) {
    await builder.alterCollection('issues', (collection) => {
      collection.dropField('ownerId');
    });
    await builder.alterCollection('featurePoints', (collection) => {
      collection.dropField('ownerId');
    });
  },
});

export default migration;
