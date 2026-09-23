import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * Timeline entries and comments first stored the username (for example `chenlin`)
 * while the team reads display names (陈霖). New rows use the display name now;
 * this pass rewrites the rows that were written before the change, matching by the
 * user id so renamed accounts stay correct.
 */
const seed: SeedDefinition = defineSeed({
  name: '202609220006_seed_actor_display_names',

  async run({ query }) {
    const users = await query
      .selectFrom('user')
      .select(['id', 'name'])
      .execute();

    for (const user of users) {
      if (typeof user.id !== 'string' || user.id === '') continue;
      await query
        .updateTable('problemComments')
        .set({ authorName: user.name })
        .where('authorId', '=', user.id)
        .where('authorName', '!=', user.name)
        .execute();
      await query
        .updateTable('problemActivities')
        .set({ actorName: user.name })
        .where('actorId', '=', user.id)
        .where('actorName', '!=', user.name)
        .execute();
    }
  },
});

export default seed;
