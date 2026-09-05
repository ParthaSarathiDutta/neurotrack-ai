import {
  MOTION_EARLIEST_ONSET_US,
  MOTION_EXPECTED_ONSET_US,
  MOTION_FLOOR_MULTIPLIER,
  MOTION_MIN_CONSECUTIVE_FRAMES,
  MOTION_NOISE_SAMPLE_FRAMES,
  MOTION_PIXEL_THRESHOLD,
} from '../constants';

export interface MotionFrameSignals {
  /** Sum of absolute per-pixel differences inside the platform mask. */
  sumDiff: number;
  /** Pixels whose absolute difference exceeds MOTION_PIXEL_THRESHOLD. */
  activePixels: number;
  /** Maximum single-pixel absolute difference inside the mask. */
  maxPixelDiff: number;
}

export interface MotionOnsetResult {
  startFrameIndex: number;
  startTimeUs: number;
  confidence: number;
  noiseFloor: number;
}

export interface MotionOnsetSeries {
  /** Per-frame-pair signals ordered in time. */
  signals: MotionFrameSignals[];
  /** Timestamp (µs) for the later frame in each pair. */
  pairTimeUs: number[];
}

/** Compute per-frame motion signals inside a circular platform mask. */
export function computeMotionSignalsInMask(
  frames: Uint8ClampedArray[],
  width: number,
  height: number,
  center: { x: number; y: number },
  radius: number,
  pixelThreshold = MOTION_PIXEL_THRESHOLD,
): MotionFrameSignals[] {
  const signals: MotionFrameSignals[] = [];
  const r2 = radius * radius;

  for (let f = 1; f < frames.length; f += 1) {
    const prev = frames[f - 1];
    const curr = frames[f];
    let sumDiff = 0;
    let activePixels = 0;
    let maxPixelDiff = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const dx = x - center.x;
        const dy = y - center.y;
        if (dx * dx + dy * dy > r2) continue;
        const idx = (y * width + x) * 4;
        const diff = Math.abs(curr[idx] - prev[idx]);
        sumDiff += diff;
        if (diff >= pixelThreshold) activePixels += 1;
        if (diff > maxPixelDiff) maxPixelDiff = diff;
      }
    }

    signals.push({ sumDiff, activePixels, maxPixelDiff });
  }
  return signals;
}

/** @deprecated Prefer computeMotionSignalsInMask — kept for legacy sum-only callers. */
export function computeFrameDiffsInMask(
  frames: Uint8ClampedArray[],
  width: number,
  height: number,
  center: { x: number; y: number },
  radius: number,
): number[] {
  return computeMotionSignalsInMask(frames, width, height, center, radius).map((s) => s.sumDiff);
}

/** Trimmed median for robust noise-floor estimation (resists keyframe spikes). */
export function robustNoiseFloor(values: number[], trimFraction = 0.1): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const trim = Math.floor(sorted.length * trimFraction);
  const trimmed = sorted.slice(trim, sorted.length - trim || sorted.length);
  const mid = Math.floor(trimmed.length / 2);
  return trimmed.length % 2 === 0 ? (trimmed[mid - 1] + trimmed[mid]) / 2 : trimmed[mid];
}

/** Confidence from motion strength and plausibility relative to expected ~5 s onset. */
export function computeOnsetConfidence(
  peak: number,
  threshold: number,
  minConsecutive: number,
  startTimeUs: number,
): number {
  const strength = Math.min(1, peak / (threshold * minConsecutive * 2));
  const timingWindowUs = 800_000;
  const timingDelta = Math.abs(startTimeUs - MOTION_EXPECTED_ONSET_US);
  const timingFactor =
    startTimeUs < MOTION_EARLIEST_ONSET_US
      ? 0.25
      : Math.max(0.45, 1 - timingDelta / timingWindowUs);
  return Math.min(1, strength * timingFactor);
}

/**
 * Detect trial start from sustained motion inside the platform mask.
 * Uses active-pixel count (rim-sensitive) with max-pixel fallback — not center-biased sum alone.
 */
export function detectMotionOnset(
  series: MotionOnsetSeries,
  options: {
    noiseSampleCount?: number;
    floorMultiplier?: number;
    minConsecutive?: number;
    /** Indices into series.signals that belong to the quiet/noise window. */
    noiseIndices?: number[];
    /** Indices into series.signals eligible for onset detection. */
    scanIndices?: number[];
    earliestOnsetUs?: number;
  } = {},
): MotionOnsetResult | null {
  const { signals, pairTimeUs } = series;
  if (signals.length === 0 || pairTimeUs.length !== signals.length) return null;

  const floorMultiplier = options.floorMultiplier ?? MOTION_FLOOR_MULTIPLIER;
  const minConsecutive = options.minConsecutive ?? MOTION_MIN_CONSECUTIVE_FRAMES;
  const noiseSampleCount = options.noiseSampleCount ?? MOTION_NOISE_SAMPLE_FRAMES;
  const earliestOnsetUs = options.earliestOnsetUs ?? MOTION_EARLIEST_ONSET_US;

  const noisePool =
    options.noiseIndices && options.noiseIndices.length > 0
      ? options.noiseIndices.map((i) => signals[i]?.activePixels ?? 0)
      : signals.slice(0, Math.min(noiseSampleCount, signals.length)).map((s) => s.activePixels);

  const noiseFloor = robustNoiseFloor(noisePool);
  const threshold = Math.max(noiseFloor * floorMultiplier + 1, 12);

  const scanPool =
    options.scanIndices && options.scanIndices.length > 0
      ? options.scanIndices.filter((i) => pairTimeUs[i] >= earliestOnsetUs)
      : signals.map((_, i) => i).filter((i) => pairTimeUs[i] >= earliestOnsetUs);

  let consecutive = 0;
  for (const i of scanPool) {
    const s = signals[i];
    if (!s) continue;
    if (s.activePixels >= threshold) {
      consecutive += 1;
      if (consecutive >= minConsecutive) {
        const startIdx = i - minConsecutive + 1;
        const peak = signals
          .slice(startIdx, i + 1)
          .reduce((acc, sig) => acc + sig.activePixels, 0);
        const confidence = computeOnsetConfidence(peak, threshold, minConsecutive, pairTimeUs[startIdx]);
        return {
          startFrameIndex: startIdx,
          startTimeUs: pairTimeUs[startIdx],
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

/** Pick timestamp-index rows whose timeUs lies in [startUs, endUs]. */
export function indexEntriesInTimeRange(
  timestampIndex: Array<{ timeUs: number }>,
  startUs: number,
  endUs: number,
): Array<{ index: number; timeUs: number }> {
  return timestampIndex
    .map((e, index) => ({ index, timeUs: e.timeUs }))
    .filter((e) => e.timeUs >= startUs && e.timeUs <= endUs);
}

/** Evenly subsample timestamp-index rows while preserving temporal order. */
export function sampleEvenlySpacedEntries(
  entries: Array<{ index: number; timeUs: number }>,
  targetCount: number,
): Array<{ index: number; timeUs: number }> {
  if (entries.length <= targetCount) return entries;
  const result: typeof entries = [];
  for (let i = 0; i < targetCount; i += 1) {
    const j = Math.round((i / (targetCount - 1)) * (entries.length - 1));
    result.push(entries[j]);
  }
  return result;
}
