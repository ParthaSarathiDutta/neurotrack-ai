import { describe, expect, it } from 'vitest';
import {
  censorBoundaryFrameIndex,
  censorBoundaryTimeUs,
  entryToCensorFrameIndices,
} from '../src/domain/events/holeProximity';

const index = [
  { frameIndex: 0, timeUs: 0 },
  { frameIndex: 100, timeUs: 10_000_000 },
  { frameIndex: 200, timeUs: 20_000_000 },
  { frameIndex: 300, timeUs: 30_000_000 },
];

describe('optional protocol cutoff', () => {
  const baseWindow = {
    startTimeUs: 5_000_000,
    proposedStartTimeUs: 5_000_000,
    endTimeUs: 30_000_000,
    proposedEndTimeUs: 30_000_000,
  };

  it('uses trial end / recording end when cutoff is null', () => {
    const censor = censorBoundaryTimeUs({ ...baseWindow, cutoffSeconds: null }, index);
    expect(censor).toBe(30_000_000);
    expect(censorBoundaryFrameIndex({ ...baseWindow, cutoffSeconds: null }, index)).toBe(300);
  });

  it('applies explicit cutoff as earliest boundary', () => {
    const censor = censorBoundaryTimeUs({ ...baseWindow, cutoffSeconds: 15 }, index);
    expect(censor).toBe(20_000_000);
    expect(censorBoundaryFrameIndex({ ...baseWindow, cutoffSeconds: 15 }, index)).toBe(200);
  });

  it('respects trial end before cutoff and recording end', () => {
    const censor = censorBoundaryTimeUs(
      { ...baseWindow, endTimeUs: 12_000_000, cutoffSeconds: null },
      index,
    );
    expect(censor).toBe(12_000_000);
  });
});

describe('entryToCensorFrameIndices', () => {
  it('does not extend pixel window beyond censor frame', () => {
    const window = {
      startTimeUs: 5_000_000,
      proposedStartTimeUs: 5_000_000,
      endTimeUs: 30_000_000,
      proposedEndTimeUs: 30_000_000,
      cutoffSeconds: 15,
    };
    const censorUs = censorBoundaryTimeUs(window, index)!;
    const censorFrame = censorBoundaryFrameIndex(window, index)!;
    const frames = entryToCensorFrameIndices(index, 100, censorUs, censorFrame);
    expect(frames).toEqual([100, 200]);
  });
});
