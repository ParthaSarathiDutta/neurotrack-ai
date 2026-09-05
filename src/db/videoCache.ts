import { db, type VideoBlobRecord } from './database';

export const DEFAULT_CACHE_BUDGET_BYTES = 50 * 1024 * 1024;

export async function getCachedVideo(fingerprint: string): Promise<VideoBlobRecord | undefined> {
  const record = await db.videoBlobs.get(fingerprint);
  if (record) {
    await db.videoBlobs.update(fingerprint, {
      lastAccessedAt: new Date().toISOString(),
    });
  }
  return record;
}

export async function putVideoInCache(
  fingerprint: string,
  blob: Blob,
  fileName: string,
  budgetBytes = DEFAULT_CACHE_BUDGET_BYTES,
): Promise<void> {
  const byteSize = blob.size;
  const now = new Date().toISOString();

  await db.videoBlobs.put({
    fingerprint,
    blob,
    byteSize,
    fileName,
    lastAccessedAt: now,
  });

  await enforceCacheBudget(budgetBytes);
}

export async function enforceCacheBudget(budgetBytes: number): Promise<string[]> {
  const all = await db.videoBlobs.orderBy('lastAccessedAt').toArray();
  let total = all.reduce((sum, row) => sum + row.byteSize, 0);
  const evicted: string[] = [];

  while (total > budgetBytes && all.length > 0) {
    const oldest = all.shift();
    if (!oldest) break;
    await db.videoBlobs.delete(oldest.fingerprint);
    evicted.push(oldest.fingerprint);
    total -= oldest.byteSize;
  }

  return evicted;
}

export async function clearVideoCache(): Promise<void> {
  await db.videoBlobs.clear();
}

export async function listCachedFingerprints(): Promise<string[]> {
  return db.videoBlobs.orderBy('fingerprint').keys() as Promise<string[]>;
}

export async function getTotalCacheBytes(): Promise<number> {
  const all = await db.videoBlobs.toArray();
  return all.reduce((sum, row) => sum + row.byteSize, 0);
}

/** Test helper: force eviction by setting a tiny budget. */
export async function evictAllFromCache(): Promise<string[]> {
  const keys = await listCachedFingerprints();
  await clearVideoCache();
  return keys;
}
