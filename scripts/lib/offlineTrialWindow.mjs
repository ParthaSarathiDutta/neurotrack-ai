/**
 * Offline trial-window proposal — mirrors trialWindowService + motion onset path.
 */
import {
  MOTION_EARLIEST_ONSET_US,
  MOTION_QUIET_END_US,
  MOTION_SCAN_END_US,
} from '../../src/domain/constants.ts';
import {
  computeMotionSignalsInMask,
  detectMotionOnset,
  indexEntriesInTimeRange,
  sampleEvenlySpacedEntries,
} from '../../src/domain/trialWindow/motionOnset.ts';

/**
 * @param {{
 *   timestampIndex: Array<{ timeUs: number; frameIndex: number }>;
 *   geometry: { platformCenter?: { x: number; y: number } | null; platformRadiusPx?: number | null };
 *   width: number;
 *   height: number;
 *   getFramePixels: (frameIndex: number) => Uint8ClampedArray;
 * }} input
 */
export function proposeTrialWindowOffline({
  timestampIndex,
  geometry,
  width,
  height,
  getFramePixels,
}) {
  const lastTimeUs = timestampIndex[timestampIndex.length - 1]?.timeUs ?? null;
  if (timestampIndex.length < 2 || lastTimeUs == null) {
    return { success: false, failureReason: 'missing timestamp index', startTimeUs: null, confidence: null };
  }

  const center = geometry.platformCenter ?? { x: width / 2, y: height / 2 };
  const radius = geometry.platformRadiusPx ?? width * 0.32;

  const timelineEntries = indexEntriesInTimeRange(timestampIndex, 0, MOTION_SCAN_END_US);
  if (timelineEntries.length < 2) {
    return {
      success: false,
      failureReason: 'insufficient frames in 0–7 s scan window',
      startTimeUs: null,
      confidence: null,
    };
  }

  const sampledEntries = sampleEvenlySpacedEntries(timelineEntries, 48);
  const pixelFrames = sampledEntries.map((e) => getFramePixels(e.index));
  if (pixelFrames.length < 2) {
    return {
      success: false,
      failureReason: 'could not decode motion-onset frames',
      startTimeUs: null,
      confidence: null,
    };
  }

  const signals = computeMotionSignalsInMask(pixelFrames, width, height, center, radius);
  const pairTimeUs = sampledEntries.slice(1).map((e) => e.timeUs);
  const noisePairIndices = pairTimeUs
    .map((t, i) => (t < MOTION_QUIET_END_US ? i : -1))
    .filter((i) => i >= 0);
  const scanPairIndices = pairTimeUs
    .map((t, i) => (t >= MOTION_EARLIEST_ONSET_US ? i : -1))
    .filter((i) => i >= 0);

  const onset = detectMotionOnset({ signals, pairTimeUs }, {
    noiseIndices: noisePairIndices.length > 0 ? noisePairIndices : undefined,
    scanIndices: scanPairIndices.length > 0 ? scanPairIndices : undefined,
  });

  if (!onset) {
    return {
      success: false,
      failureReason: 'no sustained motion onset',
      startTimeUs: null,
      confidence: null,
    };
  }

  return {
    success: true,
    startTimeUs: onset.startTimeUs,
    confidence: onset.confidence,
    failureReason: null,
  };
}
