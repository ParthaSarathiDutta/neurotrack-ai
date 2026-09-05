import { beforeEach, describe, expect, it } from 'vitest';
import { clearSessionForTests } from '../src/db/database';
import {
  DEFAULT_CACHE_BUDGET_BYTES,
  enforceCacheBudget,
  getTotalCacheBytes,
  putVideoInCache,
} from '../src/db/videoCache';

describe('videoCache', () => {
  beforeEach(async () => {
    await clearSessionForTests();
  });

  it('evicts oldest entries when budget exceeded', async () => {
    await putVideoInCache('a', new Blob([new Uint8Array(1000)]), 'a.mp4', DEFAULT_CACHE_BUDGET_BYTES);
    await new Promise((r) => setTimeout(r, 5));
    await putVideoInCache('b', new Blob([new Uint8Array(1000)]), 'b.mp4', DEFAULT_CACHE_BUDGET_BYTES);

    const evicted = await enforceCacheBudget(1000);
    expect(evicted.length).toBeGreaterThan(0);
    const total = await getTotalCacheBytes();
    expect(total).toBeLessThanOrEqual(1000);
  });
});
