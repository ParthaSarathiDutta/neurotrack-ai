import { computeFrameDiffsInMask, detectMotionOnset, sampleFrameIndices } from '../domain/trialWindow/motionOnset';
import type { TrialRecord, TrialWindow } from '../domain/types';
import { captureFramesViaVideo, getVideoBlobUrl } from './videoCaptureService';

export interface TrialWindowProposal {
  trialWindow: Partial<TrialWindow>;
  startSeconds: number;
}

export async function proposeTrialWindow(trial: TrialRecord): Promise<TrialWindowProposal | null> {
  if (!trial.metadata || trial.timestampIndex.length < 2) return null;

  const center = trial.geometry.platformCenter ?? {
    x: trial.metadata.codedWidth / 2,
    y: trial.metadata.codedHeight / 2,
  };
  const radius = trial.geometry.platformRadiusPx ?? trial.metadata.codedWidth * 0.32;

  const width = trial.metadata.codedWidth;
  const height = trial.metadata.codedHeight;

  // Scan 3–7 s wall-clock (covers ~5 s motion onset on all sample clips)
  const startUs = 3_000_000;
  const endUs = 7_000_000;
  const candidates = trial.timestampIndex
    .map((e, i) => ({ i, timeUs: e.timeUs }))
    .filter((e) => e.timeUs >= startUs && e.timeUs <= endUs);
  if (candidates.length < 2) {
    return null;
  }
  const count = Math.min(40, candidates.length);
  const indices = sampleFrameIndices(candidates.length, count, 0, candidates.length - 1).map(
    (j) => candidates[j].i,
  );

  const url = await getVideoBlobUrl(trial.fingerprint);
  const pixelFrames = await captureFramesViaVideo(url, trial.timestampIndex, indices, width, height);
  URL.revokeObjectURL(url);

  const diffs = computeFrameDiffsInMask(pixelFrames, width, height, center, radius);
  const indexSlice = indices.slice(0, diffs.length + 1).map((i) => trial.timestampIndex[i]);
  const onset = detectMotionOnset(diffs, indexSlice);

  const lastTimeUs = trial.timestampIndex[trial.timestampIndex.length - 1].timeUs;

  if (!onset) {
    return {
      trialWindow: {
        proposedStartTimeUs: null,
        proposedEndTimeUs: lastTimeUs,
        startTimeUs: null,
        endTimeUs: lastTimeUs,
        source: 'auto',
        motionOnsetConfidence: 0,
      },
      startSeconds: 0,
    };
  }

  return {
    startSeconds: onset.startTimeUs / 1_000_000,
    trialWindow: {
      proposedStartTimeUs: onset.startTimeUs,
      proposedEndTimeUs: lastTimeUs,
      startTimeUs: onset.startTimeUs,
      endTimeUs: lastTimeUs,
      source: 'auto',
      motionOnsetConfidence: onset.confidence,
    },
  };
}
