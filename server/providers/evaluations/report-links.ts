import {
  EvaluationError,
  deliveryKey,
  hash,
  subjectOf,
  validateDocument,
} from './protocol.js';
import { parseProblemSubmission } from './problems.js';

/** Validate metadata only. The receiver never fetches the producer's HTML or images. */
export function parseLinkedReport(
  bytes: Buffer,
  headers: {
    version: string;
    type: string;
    idempotencyKey: string;
    sha256: string;
    payloadSha256: string;
  },
) {
  const invalid = (): never => {
    throw new EvaluationError(
      'INVALID_INPUT',
      'Invalid report link submission.',
    );
  };
  if (
    headers.version !== '1' ||
    !/^[a-f0-9]{64}$/.test(headers.sha256) ||
    hash(bytes) !== headers.payloadSha256
  )
    return invalid();
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return invalid();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  const body = value as Record<string, unknown>;
  if (
    body.version !== 1 ||
    Object.keys(body).some(
      (key) => !['version', 'document', 'problems', 'reportUrl'].includes(key),
    )
  )
    return invalid();
  const document = validateDocument(body.document);
  const subject = subjectOf(document);
  if (
    headers.type !== subject.type ||
    headers.idempotencyKey !== deliveryKey(subject)
  )
    return invalid();
  const archive =
    document.type === 'evaluation-report'
      ? document.links.find((link) => link.rel === 'report-archive')
      : undefined;
  const pathname = archive?.path;
  if (
    pathname &&
    (!pathname.startsWith('reports/') ||
      pathname.split('/').some((part) => part === '..' || part === '.') ||
      /[?#%\\]/.test(pathname))
  )
    return invalid();
  const [owner, repository] = document.source.instance.split('/');
  const expected = pathname
    ? new URL(pathname, `https://${owner}.github.io/${repository}/`).href
    : null;
  if (
    body.reportUrl !== expected ||
    (document.type === 'evaluation-report' && !expected)
  )
    return invalid();
  if (expected && expected.length > 2048) return invalid();
  return {
    document,
    reportUrl: expected,
    sha256: headers.sha256,
    problems: parseProblemSubmission(
      { version: 1, problems: body.problems },
      document,
    ),
  };
}
