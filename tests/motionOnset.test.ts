import { describe, expect, it } from 'vitest';
import { detectMotionOnset } from '../src/domain/trialWindow/motionOnset';

describe('motionOnset', () => {
  it('detects onset after quiet period', () => {
    const diffs = [...Array(50).fill(0.5), ...Array(20).fill(50), ...Array(30).fill(5)];
    const index = diffs.map((_, i) => ({ timeUs: i * 33_333 }));
    const result = detectMotionOnset(diffs, index, {
      noiseSampleCount: 30,
      floorMultiplier: 3,
      minConsecutive: 3,
    });
    expect(result).not.toBeNull();
    expect(result!.startFrameIndex).toBeGreaterThanOrEqual(48);
    expect(result!.startFrameIndex).toBeLessThan(55);
  });

  it('rejects single-frame spikes', () => {
    const diffs = [...Array(40).fill(0.5), 100, ...Array(40).fill(0.5)];
    const index = diffs.map((_, i) => ({ timeUs: i * 33_333 }));
    const result = detectMotionOnset(diffs, index, { minConsecutive: 3 });
    expect(result).toBeNull();
  });
});
