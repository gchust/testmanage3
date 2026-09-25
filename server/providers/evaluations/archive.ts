import { crc32 } from 'node:zlib';
import type { driveManagerToken } from '@nocobase/app-server/drive';
import type { ServiceToken } from '@nocobase/service-provider';
import type { ServerFileRepositoryManager } from '@nocobase/app-plugin-file/server';
import { check } from './protocol.js';

const LIMITS = { zip: 64 * 1024 ** 2, unpacked: 128 * 1024 ** 2, files: 2048 };
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

type Drive = typeof driveManagerToken extends ServiceToken<infer T> ? T : never;
/** Read-only compatibility for archives already stored by the former receiver. */
export class EvaluationArchive {
  constructor(
    private readonly manager: ServerFileRepositoryManager,
    private readonly drive: Drive,
  ) {}
  async read(id: string): Promise<Buffer> {
    const files = this.manager.repository('evaluationBundleFiles', {
      connection: 'main',
      disk: 'local',
      accessPath: '/evaluations/archive',
      policy: { read: true, create: false, update: false, delete: false },
    });
    const record = await files.findOne({ filter: { id } });
    if (!record) throw new Error('Stored archive is missing.');
    const stream = await this.drive.use(record.disk).getStream(record.key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream)
      chunks.push(Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  }
}
