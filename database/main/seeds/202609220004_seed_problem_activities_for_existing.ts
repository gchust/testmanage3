import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * Backfills a creation entry for problems that existed before the timeline did.
 *
 * The `issues` table never stored who created a row, so the actor is recorded as
 * `system` with the problem's own creation time. New problems get their real
 * creator from the session; this pass only fills the gap the import left and skips
 * any problem that already has timeline entries.
 */
const seed: SeedDefinition = defineSeed({
  name: '202609220004_seed_problem_activities_for_existing',

  async run({ query }) {
    const problems = await query
      .selectFrom('issues')
      .select(['id', 'status', 'createdAt'])
      .execute();
    const recorded = await query
      .selectFrom('problemActivities')
      .select(['problemId'])
      .execute();
    const known = new Set(recorded.map((row) => Number(row.problemId)));
    const missing = problems.filter(
      (problem) => !known.has(Number(problem.id)),
    );

    if (missing.length === 0) {
      return;
    }

    await query
      .insertInto('problemActivities')
      .values(
        missing.map((problem) => ({
          problemId: problem.id,
          actorId: null,
          actorName: 'system',
          kind: 'created',
          fromStatus: null,
          toStatus: problem.status,
          createdAt: problem.createdAt,
        })),
      )
      .execute();
  },
});

export default seed;
