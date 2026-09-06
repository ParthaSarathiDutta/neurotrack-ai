import { describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  analyzeTimestampIndexIntegrity,
  buildTimestampIndex,
  formatPresentationTimeSeconds,
} from '../src/domain/timing';

const DATA = join(process.cwd(), 'data', 'barnes-maze');

describe('timestamp integrity', () => {
  it('formatPresentationTimeSeconds distinguishes adjacent test50 frames that collide at 3 decimals', () => {
    expect(formatPresentationTimeSeconds(6_700_000, 3)).toBe('6.700');
    expect(formatPresentationTimeSeconds(6_700_065, 3)).toBe('6.700');
    expect(formatPresentationTimeSeconds(6_700_000, 6)).toBe('6.700000');
    expect(formatPresentationTimeSeconds(6_700_065, 6)).toBe('6.700065');
  });

  it('analyzeTimestampIndexIntegrity detects display-only collisions vs real duplicates', () => {
    const displayOnly = [{ timeUs: 6_700_000 }, { timeUs: 6_700_065 }];
    const displayStats = analyzeTimestampIndexIntegrity(displayOnly);
    expect(displayStats.duplicateAdjacentTimeUs).toBe(0);
    expect(displayStats.nonMonotonicAdjacent).toBe(0);
    expect(displayStats.displayCollisionAt3Decimals).toBe(1);

    const realDup = buildTimestampIndex([
      { cts: 108544, timescale: 15360 },
      { cts: 108544, timescale: 15360 },
    ]);
    const dupStats = analyzeTimestampIndexIntegrity(realDup);
    expect(dupStats.duplicateAdjacentTimeUs).toBe(1);
    expect(dupStats.nonMonotonicAdjacent).toBe(0);
  });

  it('container timestamp index is monotonic non-decreasing on sample clips', async () => {
    if (!['test50', 'test51', 'test53'].every((n) => existsSync(join(DATA, `${n}.mp4`)))) {
      return;
    }

    const { extractMp4TimestampIndex } = await import('../scripts/lib/mp4TimestampIndex.mjs');

    const expected = {
      test50: { frames: 5539, duplicateAdjacentTimeUs: 162 },
      test51: { frames: 741, duplicateAdjacentTimeUs: 17 },
      test53: { frames: 905, duplicateAdjacentTimeUs: 25 },
    };

    for (const name of ['test50', 'test51', 'test53'] as const) {
      const index = await extractMp4TimestampIndex(join(DATA, `${name}.mp4`));
      const stats = analyzeTimestampIndexIntegrity(index);
      expect(stats.frameCount).toBe(expected[name].frames);
      expect(stats.nonMonotonicAdjacent).toBe(0);
      expect(stats.duplicateAdjacentTimeUs).toBe(expected[name].duplicateAdjacentTimeUs);
    }
  });
});
