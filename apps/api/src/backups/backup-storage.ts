import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GetObjectCommand, DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Where backup blobs live. Local disk in dev/single-host; S3-compatible object
 * storage (Cloudflare R2 / AWS S3) in any containerised or serverless deploy,
 * where the container filesystem is ephemeral and resets on restart.
 *
 * Selected by BACKUP_STORAGE ('local' | 's3'). See .env.production.example.
 */
export interface BackupStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalBackupStorage implements BackupStorage {
  private dir() {
    const dir = join(__dirname, '..', '..', '..', '..', 'storage', 'backups');
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  async put(key: string, data: Buffer) { writeFileSync(join(this.dir(), key), data); }
  async get(key: string) { return readFileSync(join(this.dir(), key)); }
  async delete(key: string) { const p = join(this.dir(), key); if (existsSync(p)) unlinkSync(p); }
}

class S3BackupStorage implements BackupStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  constructor() {
    const endpoint = requireEnv('BACKUP_S3_ENDPOINT'); // R2: https://<accountid>.r2.cloudflarestorage.com
    this.bucket = requireEnv('BACKUP_S3_BUCKET');
    this.client = new S3Client({
      region: process.env.BACKUP_S3_REGION ?? 'auto', // R2 uses 'auto'
      endpoint,
      credentials: {
        accessKeyId: requireEnv('BACKUP_S3_ACCESS_KEY_ID'),
        secretAccessKey: requireEnv('BACKUP_S3_SECRET_ACCESS_KEY'),
      },
      forcePathStyle: true, // required for R2
    });
  }
  async put(key: string, data: Buffer) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: 'application/gzip' }));
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required when BACKUP_STORAGE=s3`);
  return v;
}

let singleton: BackupStorage | null = null;
export function getBackupStorage(): BackupStorage {
  if (!singleton) {
    singleton = process.env.BACKUP_STORAGE === 's3' ? new S3BackupStorage() : new LocalBackupStorage();
  }
  return singleton;
}
