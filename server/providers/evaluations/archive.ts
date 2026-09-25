import type { driveManagerToken } from '@nocobase/app-server/drive';
import type { ServiceToken } from '@nocobase/service-provider';
import { type ServerFileRepositoryManager } from '@nocobase/app-plugin-file/server';
import { hash } from './protocol.js';

type Drive = typeof driveManagerToken extends ServiceToken<infer T> ? T : never;
/** Protocol adapter only: File Repository owns upload, metadata and storage. */
export class EvaluationArchive {
  constructor(
    private readonly manager: ServerFileRepositoryManager,
    private readonly drive: Drive,
  ) {}
  private files() {
    return this.manager.repository('evaluationBundleFiles', {
      connection: 'main',
      disk: 'local',
      accessPath: '/evaluations/archive',
      policy: { read: true, create: true, update: false, delete: true },
    });
  }
  async store(bytes: Buffer, digest: string): Promise<string> {
    const { record } = await this.files().uploadOne({
      file: new File([new Uint8Array(bytes)], digest + '.zip', {
        type: 'application/zip',
      }),
    });
    if (hash(await this.read(record.id)) !== digest)
      throw new Error('Stored archive checksum mismatch.');
    return record.id;
  }
  async read(id: string): Promise<Buffer> {
    const record = await this.files().findOne({ filter: { id } });
    if (!record) throw new Error('Stored archive is missing.');
    const stream = await this.drive.use(record.disk).getStream(record.key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream)
      chunks.push(Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  }
  async discard(id: string): Promise<void> {
    const record = await this.files().findOne({ filter: { id } });
    if (!record) return;
    await this.drive.use(record.disk).delete(record.key);
    await this.files().deleteOne({ filter: { id } });
  }
}
