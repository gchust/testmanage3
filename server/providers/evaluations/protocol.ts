import { createHash } from 'node:crypto';
import {
  documentSchema,
  type EvaluationDocument,
  type DeliverySubject,
} from './document.js';
export type { EvaluationDocument } from './document.js';

export class EvaluationError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_BUNDLE'
      | 'CONFLICT'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'INVALID_INPUT'
      | 'TOO_LARGE',
    message: string,
  ) {
    super(message);
  }
}
export const hash = (data: string | Buffer): string =>
  createHash('sha256').update(data).digest('hex');
export function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new EvaluationError('INVALID_BUNDLE', message);
}
export function subjectOf(document: EvaluationDocument): DeliverySubject {
  return {
    type: document.type,
    key:
      document.type === 'evaluation-report'
        ? document.run.key
        : document.batch.subjectKey,
    revision: document.revision,
    sourceInstance: document.source.instance,
  };
}
export function deliveryKey(subject: DeliverySubject): string {
  return (
    'nb3-eval-v1-' +
    hash(
      [
        subject.sourceInstance,
        subject.type,
        subject.key,
        subject.revision,
      ].join('\n'),
    )
  );
}
export function subjectId(document: EvaluationDocument): string {
  const subject = subjectOf(document);
  return hash([subject.sourceInstance, subject.type, subject.key].join('\n'));
}
/** Validate consumed fields; retain opaque metadata verbatim for immutable replay checks. */
export function validateDocument(value: unknown): EvaluationDocument {
  if (documentSchema.safeParse(value).success)
    return value as EvaluationDocument;
  throw new EvaluationError(
    'INVALID_BUNDLE',
    'Invalid factory report metadata.',
  );
}

/** Exactly the producer/review/QA ordering in factory ff7e1e1, then revision. */
export function precedenceRank(document: EvaluationDocument): string {
  let tuple: number[];
  if (document.type === 'evaluation-batch')
    tuple = [document.batch.sequence, document.revision];
  else {
    const p = document.precedence;
    tuple = [
      Date.parse(p.producer.startedAt ?? '') || 0,
      p.producer.runId ?? 0,
      p.producer.attempt ?? 0,
      p.reviewRubric,
      { completed: 3, partial: 2, failed: 1, 'not-reviewed': 0 }[p.reviewState],
      p.review?.kind === 'reassessment'
        ? 2
        : p.review?.kind === 'build'
          ? 1
          : 0,
      Date.parse(p.review?.at ?? '') || 0,
      p.review?.runId ?? 0,
      p.review?.attempt ?? 0,
      { complete: 2, partial: 1, none: 0 }[p.qaCoverage],
      document.revision,
    ];
  }
  check(
    tuple.every((n) => Number.isSafeInteger(n) && n >= 0),
    'Unsupported precedence value.',
  );
  return tuple.map((n) => String(n).padStart(16, '0')).join(':');
}
