import { Client } from 'minio';
import type { Readable } from 'node:stream';

/** Evidence files in MinIO (S3-compatible). Object key = evidence.storage_path */
type G = typeof globalThis & { __pcwMinio?: Client; __pcwBucketReady?: Promise<void> };

const bucket = () => process.env.MINIO_BUCKET ?? 'pcw-evidence';

function client(): Client {
  const g = globalThis as G;
  if (!g.__pcwMinio) {
    if (!process.env.MINIO_ENDPOINT) throw new Error('MINIO_ENDPOINT is not set');
    g.__pcwMinio = new Client({
      endPoint: process.env.MINIO_ENDPOINT,
      port: process.env.MINIO_PORT ? Number(process.env.MINIO_PORT) : undefined,
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY ?? '',
      secretKey: process.env.MINIO_SECRET_KEY ?? '',
      region: process.env.MINIO_REGION ?? 'us-east-1',
    });
  }
  return g.__pcwMinio;
}

async function ensureBucket() {
  const g = globalThis as G;
  g.__pcwBucketReady ??= (async () => {
    const c = client();
    if (!(await c.bucketExists(bucket()))) await c.makeBucket(bucket(), process.env.MINIO_REGION ?? 'us-east-1');
  })().catch((e) => {
    g.__pcwBucketReady = undefined;
    throw e;
  });
  return g.__pcwBucketReady;
}

export async function putObject(key: string, data: Buffer, contentType?: string) {
  await ensureBucket();
  await client().putObject(bucket(), key, data, data.length, { 'Content-Type': contentType || 'application/octet-stream' });
}

export async function getObject(key: string): Promise<{ stream: Readable; size: number; contentType?: string }> {
  await ensureBucket();
  const stat = await client().statObject(bucket(), key);
  const stream = await client().getObject(bucket(), key);
  return { stream, size: stat.size, contentType: stat.metaData?.['content-type'] };
}

export async function removeObject(key: string) {
  await ensureBucket();
  await client().removeObject(bucket(), key);
}
