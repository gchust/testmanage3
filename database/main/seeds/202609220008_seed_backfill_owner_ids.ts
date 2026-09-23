import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * Owner names predate the account association (`ownerId` -> `users.id`). This pass
 * maps every stored owner name to the account with that display name, on feature
 * points and on problems, so owner pickers and the "only mine" views work by
 * account id. Ambiguous names (two accounts with the same display name) are left
 * alone rather than guessed.
 *
 * It runs after the snapshot seed. On a fresh install where the accounts have not
 * been created yet it is a no-op; re-picking an owner in the UI writes the id
 * directly from then on.
 */
const seed: SeedDefinition = defineSeed({
  name: '202609220008_seed_backfill_owner_ids',

  async run({ query }) {
    const users = await query
      .selectFrom('user')
      .select(['id', 'name'])
      .execute();

    const idsByName = new Map<string, string[]>();
    for (const user of users) {
      const name = typeof user.name === 'string' ? user.name.trim() : '';
      if (name === '' || typeof user.id !== 'string' || user.id === '') {
        continue;
      }
      const ids = idsByName.get(name) ?? [];
      ids.push(user.id);
      idsByName.set(name, ids);
    }

    for (const [name, ids] of idsByName) {
      if (ids.length !== 1) continue;
      const ownerId = ids[0];
      await query
        .updateTable('featurePoints')
        .set({ ownerId })
        .where('owner', '=', name)
        .where('ownerId', 'is', null)
        .execute();
      await query
        .updateTable('issues')
        .set({ ownerId })
        .where('owner', '=', name)
        .where('ownerId', 'is', null)
        .execute();
    }
  },
});

export default seed;
