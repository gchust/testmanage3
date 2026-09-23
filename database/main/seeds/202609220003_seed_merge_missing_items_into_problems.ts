import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * Moves the old Example missing items into the unified problem table.
 *
 * `missing_items` and `issues` became one table on 2026-09-22 (see
 * testing-statistics/field-rubric.md §5). The executed seed that fills
 * `missing_items` cannot be edited, so this pass copies its rows into `issues` as
 * `type = example` after that seed has run — both on an existing database, where it
 * runs once now, and on a fresh install, where it runs right after the old seeds.
 * The old table stays untouched as history and is no longer read by the application.
 *
 * Status mapping: open → pending, inProgress → fixing, fixed → verified.
 */
const STATUS_MAP: Readonly<Record<string, string>> = {
  open: 'pending',
  inProgress: 'fixing',
  fixed: 'verified',
};

const seed: SeedDefinition = defineSeed({
  name: '202609220003_seed_merge_missing_items_into_problems',

  async run({ query }) {
    const items = await query
      .selectFrom('missingItems')
      .select([
        'title',
        'note',
        'featurePointId',
        'status',
        'owner',
        'createdAt',
        'updatedAt',
      ])
      .execute();

    if (items.length === 0) {
      return;
    }

    await query
      .insertInto('issues')
      .values(
        items.map((item) => ({
          title: item.title,
          description: item.note ?? null,
          featurePointId: item.featurePointId,
          type: 'example',
          status: STATUS_MAP[String(item.status)] ?? 'pending',
          owner: item.owner ?? null,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
      )
      .execute();
  },
});

export default seed;
