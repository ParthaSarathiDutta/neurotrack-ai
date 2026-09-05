import { describe, expect, it } from 'vitest';
import {
  computeMotionSignalsInMask,
  computeOnsetConfidence,
  detectMotionOnset,
  robustNoiseFloor,
} from '../src/domain/trialWindow/motionOnset';
import { MOTION_EARLIEST_ONSET_US } from '../src/domain/constants';

const quiet = { sumDiff: 500, activePixels: 2, maxPixelDiff: 4 };
const motion = { sumDiff: 50_000, activePixels: 120, maxPixelDiff: 80 };

describe('motionOnset', () => {
  it('detects onset after quiet period', () => {
    const signals = [...Array(50).fill(quiet), ...Array(20).fill(motion), ...Array(30).fill(quiet)];
    const pairTimeUs = signals.map((_, i) => (i * 0.1) * 1_000_000);
    const result = detectMotionOnset(
      { signals, pairTimeUs },
      { noiseIndices: [...Array(30).keys()] },
    );
    expect(result).not.toBeNull();
    expect(result!.startTimeUs).toBeGreaterThanOrEqual(4_500_000);
    expect(result!.startFrameIndex).toBeGreaterThanOrEqual(48);
    expect(result!.startFrameIndex).toBeLessThan(55);
  });

  it('rejects single-frame spikes', () => {
    const signals = [...Array(40).fill(quiet), motion, ...Array(40).fill(quiet)];
    const pairTimeUs = signals.map((_, i) => i * 33_333);
    const result = detectMotionOnset(
      { signals, pairTimeUs },
      { minConsecutive: 3, noiseIndices: [...Array(20).keys()] },
    );
    expect(result).toBeNull();
  });

  it('detects rim-localized motion with modest sum but sufficient active pixels', () => {
    const rimMotion = { sumDiff: 800, activePixels: 45, maxPixelDiff: 55 };
    const signals = [...Array(40).fill(quiet), ...Array(5).fill(rimMotion), ...Array(20).fill(quiet)];
    const pairTimeUs = signals.map((_, i) => (3 + i * 0.1) * 1_000_000);
    const result = detectMotionOnset(
      { signals, pairTimeUs },
      { noiseIndices: [...Array(25).keys()], scanIndices: signals.map((_, i) => i) },
    );
    expect(result).not.toBeNull();
    expect(result!.startTimeUs).toBeGreaterThanOrEqual(3_000_000);
  });

  it('robustNoiseFloor resists outlier spikes in noise window', () => {
    const samples = [...Array(20).fill(3), 500, 600];
    expect(robustNoiseFloor(samples)).toBeLessThan(10);
  });

  it('ignores onset candidates before earliest onset time', () => {
    const earlyMotion = { sumDiff: 50_000, activePixels: 120, maxPixelDiff: 80 };
    const signals = [...Array(20).fill(quiet), ...Array(5).fill(earlyMotion), ...Array(55).fill(quiet)];
    const pairTimeUs = signals.map((_, i) => (3 + i * 0.05) * 1_000_000);
    const result = detectMotionOnset(
      { signals, pairTimeUs },
      {
        noiseIndices: [...Array(15).keys()],
        scanIndices: signals.map((_, i) => i),
        earliestOnsetUs: MOTION_EARLIEST_ONSET_US,
      },
    );
    expect(result).toBeNull();
  });

  it('penalizes confidence for early-onset timing', () => {
    const early = computeOnsetConfidence(360, 12, 3, 4_300_000);
    const expected = computeOnsetConfidence(360, 12, 3, 5_000_000);
    expect(early).toBeLessThan(expected);
    expect(expected).toBeGreaterThan(0.7);
  });
});

describe('computeMotionSignalsInMask', () => {
  it('counts active pixels inside platform mask only', () => {
    const w = 80;
    const h = 80;
    const frames = [new Uint8ClampedArray(w * h * 4).fill(200), new Uint8ClampedArray(w * h * 4).fill(200)];
    // Change a small cluster (rim-like localized motion)
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const x = 60 + dx;
        const y = 40 + dy;
        frames[1][(y * w + x) * 4] = 20;
      }
    }
    const center = { x: 40, y: 40 };
    const radius = 25;
    const signals = computeMotionSignalsInMask(frames, w, h, center, radius);
    expect(signals[0].activePixels).toBeGreaterThan(0);
    expect(signals[0].sumDiff).toBeGreaterThan(0);
  });
});
