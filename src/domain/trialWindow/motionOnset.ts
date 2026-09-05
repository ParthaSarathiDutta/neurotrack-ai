import {
  MOTION_FLOOR_MULTIPLIER,
  MOTION_MIN_CONSECUTIVE_FRAMES,
  MOTION_NOISE_SAMPLE_FRAMES,
} from '../constants';

export interface MotionOnsetResult {
  startFrameIndex: number;
  startTimeUs: number;
  confidence: number;
  noiseFloor: number;
}

/** Detect trial start from consecutive-frame motion inside platform mask. */
export function detectMotionOnset(
  frameDiffs: number[],
  timestampIndex: Array<{ timeUs: number }>,
  options: {
    noiseSampleCount?: number;
    floorMultiplier?: number;
    minConsecutive?: number;
  } = {},
): MotionOnsetResult | null {
  if (frameDiffs.length === 0 || timestampIndex.length < 2) return null;

  const noiseSampleCount = options.noiseSampleCount ?? MOTION_NOISE_SAMPLE_FRAMES;
  const floorMultiplier = options.floorMultiplier ?? MOTION_FLOOR_MULTIPLIER;
  const minConsecutive = options.minConsecutive ?? MOTION_MIN_CONSECUTIVE_FRAMES;

  const noiseSamples = frameDiffs.slice(0, Math.min(noiseSampleCount, frameDiffs.length));
  noiseSamples.sort((a, b) => a - b);
  const noiseFloor = noiseSamples[Math.floor(noiseSamples.length / 2)] || 0;
  const threshold = noiseFloor * floorMultiplier + 1;

  let consecutive = 0;
  for (let i = 0; i < frameDiffs.length; i += 1) {
    if (frameDiffs[i] >= threshold) {
      consecutive += 1;
      if (consecutive >= minConsecutive) {
        const startFrameIndex = i - minConsecutive + 1;
        const idx = Math.min(startFrameIndex + 1, timestampIndex.length - 1);
        const peakDiff = frameDiffs.slice(startFrameIndex, i + 1).reduce((a, b) => a + b, 0);
        const confidence = Math.min(1, peakDiff / (threshold * minConsecutive * 2));
        return {
          startFrameIndex,
          startTimeUs: timestampIndex[idx].timeUs,
          confidence,
          noiseFloor,
        };
      }
    } else {
      consecutive = 0;
    }
  }
  return null;
}

/** Compute per-frame difference sum inside a circular platform mask. */
export function computeFrameDiffsInMask(
  frames: Uint8ClampedArray[],
  width: number,
  height: number,
  center: { x: number; y: number },
  radius: number,
): number[] {
  const diffs: number[] = [];
  const r2 = radius * radius;

  for (let f = 1; f < frames.length; f += 1) {
    const prev = frames[f - 1];
    const curr = frames[f];
    let sum = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const dx = x - center.x;
        const dy = y - center.y;
        if (dx * dx + dy * dy > r2) continue;
        const idx = (y * width + x) * 4;
        sum += Math.abs(curr[idx] - prev[idx]);
      }
    }
    diffs.push(sum);
  }
  return diffs;
}

/** Sample frame indices evenly across a time range. */
export function sampleFrameIndices(
  totalFrames: number,
  count: number,
  startIndex = 0,
  endIndex?: number,
): number[] {
  const end = endIndex ?? totalFrames - 1;
  if (count <= 1) return [startIndex];
  const indices: number[] = [];
  for (let i = 0; i < count; i += 1) {
    indices.push(Math.round(startIndex + (i / (count - 1)) * (end - startIndex)));
  }
  return indices;
}
