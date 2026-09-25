import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import reportSchema from './contracts/evaluation-report.v1.schema.json' with { type: 'json' };
import batchSchema from './contracts/evaluation-batch.v1.schema.json' with { type: 'json' };
import bundleSchema from './contracts/evaluation-bundle.v1.schema.json' with { type: 'json' };
import type { EvaluationReport } from './contracts/report.js';
import type { EvaluationBatch } from './contracts/batch.js';
import type { EvaluationBundle } from './contracts/bundle.js';

export type EvaluationDocument = EvaluationReport | EvaluationBatch;
export const LIMITS = {
  zip: 64 * 1024 ** 2,
  unpacked: 128 * 1024 ** 2,
  files: 2048,
  json: 4 * 1024 ** 2,
  image: 10 * 1024 ** 2,
  images: 48 * 1024 ** 2,
  html: 32 * 1024 ** 2,
};
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
const ajv = new Ajv2020({ strict: false, allErrors: false });
addFormats.default(ajv);
const reportValid = ajv.compile<EvaluationReport>(reportSchema);
const batchValid = ajv.compile<EvaluationBatch>(batchSchema);
const manifestValid = ajv.compile<EvaluationBundle>(bundleSchema);
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Only the protocol's stored ZIP format is accepted. Never extract paths to disk. */
export function readArchive(buffer: Buffer): Map<string, Buffer> {
  check(
    buffer.length >= 22 && buffer.length <= LIMITS.zip,
    'Invalid ZIP size.',
  );
  const end = buffer.length - 22;
  check(
    buffer.readUInt32LE(end) === 0x06054b50,
    'ZIP comments and trailing data are not allowed.',
  );
  const count = buffer.readUInt16LE(end + 10);
  const start = buffer.readUInt32LE(end + 16);
  const size = buffer.readUInt32LE(end + 12);
  check(
    !buffer.readUInt16LE(end + 4) &&
      !buffer.readUInt16LE(end + 6) &&
      !buffer.readUInt16LE(end + 20),
    'Multipart ZIP is unsupported.',
  );
  check(
    count > 0 &&
      count <= LIMITS.files &&
      count === buffer.readUInt16LE(end + 8) &&
      start + size === end,
    'Invalid ZIP directory.',
  );
  const entries = new Map<string, Buffer>();
  let cursor = start,
    nextLocal = 0,
    unpacked = 0;
  for (let i = 0; i < count; i++) {
    check(
      cursor + 46 <= end && buffer.readUInt32LE(cursor) === 0x02014b50,
      'Invalid directory entry.',
    );
    const flags = buffer.readUInt16LE(cursor + 8),
      method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16),
      compressed = buffer.readUInt32LE(cursor + 20),
      length = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28),
      extra = buffer.readUInt16LE(cursor + 30),
      comment = buffer.readUInt16LE(cursor + 32);
    const offset = buffer.readUInt32LE(cursor + 42),
      external = buffer.readUInt32LE(cursor + 38);
    const mode =
      buffer.readUInt16LE(cursor + 4) >> 8 === 3 ? external >>> 16 : 0;
    check(
      (flags === 0 || flags === 0x800) &&
        method === 0 &&
        compressed === length &&
        !buffer.readUInt16LE(cursor + 34),
      'Encrypted, compressed, descriptor or split entries are unsupported.',
    );
    check(
      (mode & 0o170000) === 0 || (mode & 0o170000) === 0o100000,
      'Links and special files are forbidden.',
    );
    check(!(external & 0x10), 'Directory entries are forbidden.');
    check(
      cursor + 46 + nameLength + extra + comment <= end,
      'Truncated directory.',
    );
    const nameBytes = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = utf8.decode(nameBytes);
    check(
      name.length <= 300 &&
        /^(manifest\.json|evaluation\.json|report\.html|evidence\/[A-Za-z0-9][A-Za-z0-9._/-]*\.png)$/.test(
          name,
        ),
      'Unexpected archive path.',
    );
    check(
      name.split('/').every((part) => part && part !== '..' && part !== '.') &&
        !entries.has(name),
      'Unsafe or duplicate archive path.',
    );
    unpacked += length;
    check(
      unpacked <= LIMITS.unpacked &&
        offset === nextLocal &&
        offset + 30 <= start &&
        buffer.readUInt32LE(offset) === 0x04034b50,
      'Overlapping or oversized archive.',
    );
    const localNameLength = buffer.readUInt16LE(offset + 26),
      localExtra = buffer.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + localNameLength + localExtra,
      dataEnd = dataStart + length;
    check(
      dataEnd <= start &&
        localNameLength === nameLength &&
        buffer
          .subarray(offset + 30, offset + 30 + localNameLength)
          .equals(nameBytes),
      'Local name mismatch.',
    );
    check(
      buffer.readUInt16LE(offset + 6) === flags &&
        buffer.readUInt16LE(offset + 8) === method &&
        buffer.readUInt32LE(offset + 14) === crc &&
        buffer.readUInt32LE(offset + 18) === compressed &&
        buffer.readUInt32LE(offset + 22) === length,
      'Local metadata mismatch.',
    );
    const bytes = buffer.subarray(dataStart, dataEnd);
    check(crc32(bytes) >>> 0 === crc, 'ZIP CRC mismatch.');
    entries.set(name, bytes);
    nextLocal = dataEnd;
    cursor += 46 + nameLength + extra + comment;
  }
  check(cursor === end && nextLocal === start, 'Unaccounted ZIP data.');
  return entries;
}

export function subjectOf(
  document: EvaluationDocument,
): EvaluationBundle['subject'] {
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
export function deliveryKey(subject: EvaluationBundle['subject']): string {
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
export function validateDocument(value: unknown): EvaluationDocument {
  if (reportValid(value) || batchValid(value)) return value;
  throw new EvaluationError(
    'INVALID_BUNDLE',
    'Document does not match the supported v1 contract.',
  );
}
function unique(values: string[], label: string): void {
  check(new Set(values).size === values.length, 'Duplicate ' + label + '.');
}

export function verifyBundle(
  bytes: Buffer,
  headers: {
    sha256: string;
    idempotencyKey: string;
    type: string;
    version: string;
  },
) {
  check(
    headers.version === '1' &&
      /^[a-f0-9]{64}$/.test(headers.sha256) &&
      hash(bytes) === headers.sha256,
    'Bundle digest or version mismatch.',
  );
  try {
    const files = readArchive(bytes);
    const parse = (name: string): unknown => {
      const data = files.get(name);
      check(data && data.length <= LIMITS.json, 'Missing or oversized JSON.');
      return JSON.parse(utf8.decode(data));
    };
    const manifest = parse('manifest.json');
    check(manifestValid(manifest), 'Invalid manifest contract.');
    const document = validateDocument(parse('evaluation.json'));
    const subject = subjectOf(document);
    check(
      headers.type === subject.type &&
        headers.idempotencyKey === deliveryKey(subject),
      'Delivery identity mismatch.',
    );
    for (const key of ['type', 'key', 'revision', 'sourceInstance'] as const)
      check(
        manifest.subject[key] === subject[key],
        'Manifest subject mismatch.',
      );
    unique(
      manifest.files.map((file) => file.path),
      'manifest file',
    );
    check(
      manifest.files.length === files.size - 1,
      'Unlisted archive entries.',
    );
    let images = 0;
    for (const file of manifest.files) {
      const data = files.get(file.path);
      check(
        data && data.length === file.size && hash(data) === file.sha256,
        'Manifest checksum or size mismatch.',
      );
      if (file.path === 'evaluation.json')
        check(
          file.role === document.type && file.mediaType === 'application/json',
          'Invalid document role.',
        );
      else if (file.path === 'report.html')
        check(
          file.role === 'report-html' &&
            file.mediaType === 'text/html' &&
            data.length <= LIMITS.html,
          'Invalid HTML file.',
        );
      else {
        images += data.length;
        check(
          file.role === 'evidence' &&
            file.mediaType === 'image/png' &&
            data.length <= LIMITS.image &&
            data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
          'Invalid PNG evidence.',
        );
      }
    }
    check(images <= LIMITS.images, 'Evidence exceeds its total size limit.');
    if (document.type === 'evaluation-report') {
      unique(
        document.evidence.map((e) => e.id),
        'evidence id',
      );
      unique(
        document.reviews.map((r) => r.key),
        'review key',
      );
      unique(
        document.reviews.flatMap((r) => r.findings.map((f) => f.id)),
        'finding id',
      );
      unique(
        document.reviews.flatMap((r) => r.modules.map((m) => m.key)),
        'module key',
      );
      const evidenceIds = new Set(document.evidence.map((e) => e.id));
      const references = document.reviews.flatMap((r) => [
        ...r.findings.flatMap((f) => f.evidence),
        ...r.modules.flatMap((m) => [
          ...Object.values(m.scores).flatMap((s) => s.evidence),
          ...m.requirements.flatMap((q) => q.evidence),
          ...m.targets.flatMap((t) => t.evidence),
        ]),
      ]);
      references.push(
        ...document.qa.rounds.flatMap((r) =>
          r.checks.flatMap((c) => c.evidence),
        ),
      );
      check(
        references.every((id) => evidenceIds.has(id)),
        'Unknown evidence reference.',
      );
      for (const evidence of document.evidence) {
        if (evidence.availability === 'attached') {
          const data = evidence.attachment && files.get(evidence.attachment);
          check(
            data && hash(data) === evidence.sha256,
            'Missing or mismatched attached evidence.',
          );
        }
      }
      for (const file of manifest.files)
        for (const id of file.evidenceIds ?? [])
          check(
            document.evidence.some(
              (e) =>
                e.id === id &&
                e.attachment === file.path &&
                e.sha256 === file.sha256,
            ),
            'Invalid manifest evidence reference.',
          );
    }
    return { manifest, document, files, sha256: headers.sha256 };
  } catch (error) {
    if (error instanceof EvaluationError) throw error;
    throw new EvaluationError('INVALID_BUNDLE', 'Malformed bundle.');
  }
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
