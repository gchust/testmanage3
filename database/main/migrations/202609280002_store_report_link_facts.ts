import {
  defineMigration,
  type MigrationDefinition,
  type QueryAdapter,
  type Row,
} from '@nocobase/db';

/**
 * Problem lists showed each factory problem's source links by reading and
 * validating its whole report document, kept per process in a bounded cache. Once
 * lists referenced more reports than the cache held, every list read every
 * document again. The facts those links are built from now live beside each
 * report in `problemSource` (JSON), written when a report is received.
 *
 * This backfill is frozen with the migration: it reads the fields the receiver
 * had validated when it stored each report, and leaves `problemSource` empty for
 * a document it cannot read, whose problems are then listed without links, as
 * they were before.
 */
const BATCH = 50;

const migration: MigrationDefinition = defineMigration({
  name: '202609280002_store_report_link_facts',
  async up({ builder, query }) {
    await builder.alterCollection('evaluationReports', (collection) => {
      collection.text('problemSource');
    });

    let after = '';
    for (;;) {
      const rows = await query
        .selectFrom('evaluationReports')
        .select(['id', 'document', 'manifest', 'bundleFileId'])
        .where('type', '=', 'evaluation-report')
        .where('id', '>', after)
        .orderBy('id', 'asc')
        .limit(BATCH)
        .execute();
      if (rows.length === 0) break;
      for (const row of rows) await backfill(query, row);
      after = String(rows[rows.length - 1].id);
    }
  },
  async down({ builder }) {
    await builder.alterCollection('evaluationReports', (collection) => {
      collection.dropField('problemSource');
    });
  },
});

export default migration;

async function backfill(query: QueryAdapter, row: Row): Promise<void> {
  const facts = linkFacts(row);
  if (facts === null) return;
  await query
    .updateTable('evaluationReports')
    .set({ problemSource: JSON.stringify(facts) })
    .where('id', '=', String(row.id))
    .execute();
}

function linkFacts(row: Row): Record<string, unknown> | null {
  let document: unknown;
  let files: unknown;
  try {
    document = JSON.parse(String(row.document));
    files =
      row.bundleFileId == null
        ? ['evaluation.json']
        : (
            JSON.parse(String(row.manifest)) as {
              files?: Array<{ path?: unknown }>;
            }
          ).files?.map((file) => file.path);
  } catch {
    return null;
  }

  const report = document as {
    source?: { instance?: unknown };
    run?: { task?: { title?: unknown; repository?: unknown; issue?: unknown } };
    outcome?: { pullRequest?: { number?: unknown } | null };
    precedence?: { producer?: { runId?: unknown; attempt?: unknown } };
  } | null;
  const task = report?.run?.task;
  const producer = report?.precedence?.producer;
  const pullRequest = report?.outcome?.pullRequest;
  const positive = (value: unknown): value is number =>
    Number.isSafeInteger(value) && (value as number) > 0;
  if (
    typeof task?.title !== 'string' ||
    typeof task.repository !== 'string' ||
    !positive(task.issue) ||
    typeof report?.source?.instance !== 'string' ||
    !positive(producer?.runId) ||
    !positive(producer?.attempt) ||
    (pullRequest != null && !positive(pullRequest.number)) ||
    !Array.isArray(files) ||
    !files.every((file) => typeof file === 'string')
  ) {
    return null;
  }

  return {
    taskTitle: task.title,
    repository: task.repository,
    issue: task.issue,
    pullRequest: pullRequest == null ? null : pullRequest.number,
    sourceInstance: report.source.instance,
    runId: producer.runId,
    attempt: producer.attempt,
    files,
    hasArchive: row.bundleFileId != null,
  };
}
