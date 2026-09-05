import { medianGrayscaleFrame } from '../calibration/otsu';
import { sampleEvenlySpacedEntries } from '../trialWindow/motionOnset';
import type { TimestampIndexEntry } from '../types';

/** Frame indices evenly sampled across [startTimeUs, endTimeUs] for background model. */
export function sampleBackgroundFrameIndices(
  timestampIndex: TimestampIndexEntry[],
  startTimeUs: number,
  endTimeUs: number,
  targetCount: number,
): number[] {
  const inWindow = timestampIndex.filter(
    (e) => e.timeUs >= startTimeUs && e.timeUs <= endTimeUs,
  );
  if (inWindow.length === 0) return [];
  const sampled = sampleEvenlySpacedEntries(
    inWindow.map((e) => ({ index: e.frameIndex, timeUs: e.timeUs })),
    targetCount,
  );
  return sampled.map((s) => s.index);
}

/** Per-pixel median background from sampled RGBA frames. */
export function buildBackgroundModel(
  frames: Uint8ClampedArray[],
  width: number,
  height: number,
): Uint8ClampedArray {
  if (frames.length === 0) {
    throw new Error('Cannot build background model from zero frames');
  }
  return frames.length === 1
    ? frames[0]
    : medianGrayscaleFrame(frames, width, height);
}
