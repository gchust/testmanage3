import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * Skills and docs became availability flags (`available` / `missing` /
 * `unspecified`) on 2026-09-22: a feature point keeps growing, so `complete` and
 * `partial` no longer describe those two columns (see
 * testing-statistics/field-rubric.md). The first import wrote the retired values,
 * and an executed seed cannot be edited, so this pass normalizes what it left to
 * `unspecified`. Those rows are then re-judged against the three minimum checks
 * instead of being read as a coverage grade; values already using the new enum
 * are untouched.
 *
 * The read path rejects an unknown value, so this must run before the API is
 * used on a database that still holds `complete`/`partial` for either column.
 */
const seed: SeedDefinition = defineSeed({
  name: '202609220002_seed_normalize_availability_statuses',

  async run({ query }) {
    const retired = ['complete', 'partial'];
    const now = new Date();

    await query
      .updateTable('featurePoints')
      .set({ skillsStatus: 'unspecified', updatedAt: now })
      .where('skillsStatus', 'in', retired)
      .execute();

    await query
      .updateTable('featurePoints')
      .set({ docsStatus: 'unspecified', updatedAt: now })
      .where('docsStatus', 'in', retired)
      .execute();
  },
});

export default seed;
