import { z } from 'zod';

// Receiver metadata only. Scores, rubrics, token usage and other producer fields
// remain opaque; they are preserved for immutable replay checks and downloads.
const text = z.string().min(1).max(300);
const subjectKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,299}$/);
const repository = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const count = z.number().int().nonnegative();
const positive = z.number().int().positive();
const time = z.iso.datetime({ offset: true }).nullable();
const source = z.looseObject({
  producer: z.literal('nb3-factory'),
  instance: repository,
  project: repository,
});
const base = { schemaVersion: z.literal(1), revision: positive, source };
const reportSchema = z.looseObject({
  ...base,
  type: z.literal('evaluation-report'),
  run: z.looseObject({
    key: subjectKey,
    task: z.looseObject({
      repository,
      issue: positive,
      title: z.string().max(300),
    }),
  }),
  outcome: z.looseObject({
    pullRequest: z.looseObject({ number: positive }).nullable(),
  }),
  precedence: z.looseObject({
    producer: z.looseObject({
      startedAt: time,
      runId: positive,
      attempt: positive,
    }),
    reviewRubric: count,
    reviewState: z.enum(['completed', 'partial', 'failed', 'not-reviewed']),
    review: z
      .looseObject({
        kind: z.enum(['reassessment', 'build']).nullable(),
        at: time,
        runId: positive.nullable(),
        attempt: positive.nullable(),
      })
      .nullable(),
    qaCoverage: z.enum(['complete', 'partial', 'none']),
  }),
  links: z
    .array(z.looseObject({ rel: text, path: z.string().max(300).nullable() }))
    .max(250),
  reviews: z.array(
    z.looseObject({ findings: z.array(z.looseObject({ id: text })) }),
  ),
  qa: z.looseObject({ criteria: z.array(z.looseObject({ id: text })) }),
});
// Existing Actions also sends batch receipts; these carry no problems or HTML.
const batchSchema = z.looseObject({
  ...base,
  type: z.literal('evaluation-batch'),
  batch: z.looseObject({ subjectKey, sequence: positive }),
});
export const documentSchema = z.discriminatedUnion('type', [
  reportSchema,
  batchSchema,
]);
export type EvaluationReport = z.infer<typeof reportSchema>;
export type EvaluationDocument = z.infer<typeof documentSchema>;
export interface DeliverySubject {
  type: EvaluationDocument['type'];
  key: string;
  revision: number;
  sourceInstance: string;
}
export interface EvaluationReceipt {
  receiptId: string;
  sourceInstance: string;
  revision: number;
  bundleSha256: string;
  state: 'stored';
  runKey?: string;
  batchKey?: string;
}
export interface ArchiveManifest {
  files: Array<{ path: string }>;
}
