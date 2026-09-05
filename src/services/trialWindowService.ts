import {
  MOTION_EARLIEST_ONSET_US,
  MOTION_QUIET_END_US,
  MOTION_SCAN_END_US,
} from '../domain/constants';
import {
  computeMotionSignalsInMask,
  detectMotionOnset,
  indexEntriesInTimeRange,
  sampleEvenlySpacedEntries,
  type MotionOnsetSeries,
} from '../domain/trialWindow/motionOnset';
import type { TrialRecord, TrialWindow } from '../domain/types';
import { captureFrameViaVideo, getVideoBlobUrl } from './videoCaptureService';
import { getActiveDecoderFingerprint, initFrameDecoder, getFramePixels } from './frameService';

export interface TrialWindowProposal {
  success: boolean;
  startSeconds: number | null;
  confidence: number | null;
  failureReason: string | null;
  trialWindow: Partial<TrialWindow>;
}

function inconclusive(
  reason: string,
  lastTimeUs: number,
  existing: TrialWindow,
): TrialWindowProposal {
  return {
    success: false,
    startSeconds: null,
    confidence: null,
    failureReason: reason,
    trialWindow: {
      proposedStartTimeUs: null,
      proposedEndTimeUs: lastTimeUs,
      endTimeUs: existing.endTimeUs ?? lastTimeUs,
      source: 'auto',
      motionOnsetConfidence: null,
      detectionFailureReason: reason,
    },
  };
}

export async function proposeTrialWindow(trial: TrialRecord): Promise<TrialWindowProposal> {
  const lastTimeUs = trial.timestampIndex[trial.timestampIndex.length - 1]?.timeUs ?? null;
  if (!trial.metadata || trial.timestampIndex.length < 2 || lastTimeUs == null) {
    return {
      success: false,
      startSeconds: null,
      confidence: null,
      failureReason:
        'Cannot detect trial start — video metadata or timestamp index is missing. Set the start time manually.',
      trialWindow: {
        detectionFailureReason:
          'Cannot detect trial start — video metadata or timestamp index is missing. Set the start time manually.',
      },
    };
  }

  const center = trial.geometry.platformCenter ?? {
    x: trial.metadata.codedWidth / 2,
    y: trial.metadata.codedHeight / 2,
  };
  const radius = trial.geometry.platformRadiusPx ?? trial.metadata.codedWidth * 0.32;
  const width = trial.metadata.codedWidth;
  const height = trial.metadata.codedHeight;

  const timelineEntries = indexEntriesInTimeRange(trial.timestampIndex, 0, MOTION_SCAN_END_US);
  if (timelineEntries.length < 2) {
    return inconclusive(
      'Automatic trial start detection could not sample enough frames in the 0–7 s window. Set the start time manually.',
      lastTimeUs,
      trial.trialWindow,
    );
  }

  const sampledEntries = sampleEvenlySpacedEntries(timelineEntries, 48);
  const indices = sampledEntries.map((e) => e.index);

  let pixelFrames: Uint8ClampedArray[];
  try {
    pixelFrames = await captureFramesForTrialWindow(trial, indices, width, height);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return inconclusive(
      `Automatic trial start detection failed while decoding frames (${msg}). Set the start time manually.`,
      lastTimeUs,
      trial.trialWindow,
    );
  }

  if (pixelFrames.length < 2) {
    return inconclusive(
      'Automatic trial start detection could not decode enough frames. Set the start time manually.',
      lastTimeUs,
      trial.trialWindow,
    );
  }

  const signals = computeMotionSignalsInMask(pixelFrames, width, height, center, radius);
  const pairTimeUs = sampledEntries.slice(1).map((e) => e.timeUs);
  const series: MotionOnsetSeries = { signals, pairTimeUs };

  const noisePairIndices = pairTimeUs
    .map((t, i) => (t < MOTION_QUIET_END_US ? i : -1))
    .filter((i) => i >= 0);

  const scanPairIndices = pairTimeUs
    .map((t, i) => (t >= MOTION_EARLIEST_ONSET_US ? i : -1))
    .filter((i) => i >= 0);

  const onset = detectMotionOnset(series, {
    noiseIndices: noisePairIndices.length > 0 ? noisePairIndices : undefined,
    scanIndices: scanPairIndices.length > 0 ? scanPairIndices : undefined,
  });

  if (!onset) {
    return inconclusive(
      'Automatic trial start detection found no sustained motion onset after 4.5 s. Set the start time manually.',
      lastTimeUs,
      trial.trialWindow,
    );
  }

  return {
    success: true,
    startSeconds: onset.startTimeUs / 1_000_000,
    confidence: onset.confidence,
    failureReason: null,
    trialWindow: {
      proposedStartTimeUs: onset.startTimeUs,
      proposedEndTimeUs: lastTimeUs,
      startTimeUs: onset.startTimeUs,
      endTimeUs: lastTimeUs,
      source: 'auto',
      motionOnsetConfidence: onset.confidence,
      detectionFailureReason: null,
    },
  };
}

/** Decode frames via WebCodecs worker when possible; fall back to video seek per frame. */
async function captureFramesForTrialWindow(
  trial: TrialRecord,
  indices: number[],
  width: number,
  height: number,
): Promise<Uint8ClampedArray[]> {
  const url = await getVideoBlobUrl(trial.fingerprint);
  const frames: Uint8ClampedArray[] = [];

  let workerReady = false;
  try {
    await initFrameDecoder(trial.fingerprint);
    workerReady = getActiveDecoderFingerprint() === trial.fingerprint;
  } catch {
    workerReady = false;
  }

  try {
    for (const idx of indices) {
      const entry = trial.timestampIndex[idx];
      if (!entry) throw new Error(`Missing timestamp index for frame ${idx}`);

      if (workerReady) {
        try {
          const { data } = await getFramePixels(idx, trial.fingerprint);
          frames.push(data);
          continue;
        } catch {
          // Worker decode can fail on some delta frames — seek fallback below.
        }
      }

      frames.push(await captureFrameViaVideo(url, entry.timeUs, width, height));
    }
  } finally {
    URL.revokeObjectURL(url);
  }

  return frames;
}
