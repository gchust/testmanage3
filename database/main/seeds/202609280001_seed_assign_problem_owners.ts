import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * From 2026-09-28 a problem filed under a feature point without an owner inherits
 * that point's owner. The factory problems classified before then were filed with
 * no owner, so this pass hands each ownerless problem that has a feature point to
 * that point's owner, name and account alike. A problem with any owner, and a
 * feature point without one, are left alone.
 */
const seed: SeedDefinition = defineSeed({
  name: '202609280001_seed_assign_problem_owners',

  async run({ query }) {
    const points = await query
      .selectFrom('featurePoints')
      .select(['id', 'owner', 'ownerId'])
      .execute();

    for (const point of points) {
      if (!point.owner && !point.ownerId) continue;
      await query
        .updateTable('issues')
        .set({ owner: point.owner ?? null, ownerId: point.ownerId ?? null })
        .where('featurePointId', '=', Number(point.id))
        .where('owner', 'is', null)
        .where('ownerId', 'is', null)
        .execute();
    }
  },
});

export default seed;
