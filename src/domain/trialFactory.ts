import {
  DEFAULT_CUTOFF_SECONDS,
  TRACKING_BACKGROUND_SAMPLE_COUNT,
  TRACKING_LOW_CONFIDENCE_THRESHOLD,
  TRACKING_MAX_BLOB_AREA_FRACTION,
  TRACKING_MAX_PLAUSIBLE_SPEED_PX_PER_SEC,
  TRACKING_MIN_BLOB_AREA_FRACTION,
} from './constants';
import type { Geometry, TrialRecord, TrialWindow, Track, TrackingParams, VideoMetadata } from './types';

export const TOOL_VERSION = '0.3.0-ms3';

export function defaultTrackingParams(): TrackingParams {
  return {
    backgroundSampleCount: TRACKING_BACKGROUND_SAMPLE_COUNT,
    minBlobAreaFraction: TRACKING_MIN_BLOB_AREA_FRACTION,
    maxBlobAreaFraction: TRACKING_MAX_BLOB_AREA_FRACTION,
    maxPlausibleSpeedPxPerSec: TRACKING_MAX_PLAUSIBLE_SPEED_PX_PER_SEC,
    lowConfidenceThreshold: TRACKING_LOW_CONFIDENCE_THRESHOLD,
    toolVersion: TOOL_VERSION,
  };
}

export function createEmptyTrack(params: TrackingParams = defaultTrackingParams()): Track {
  return {
    status: 'idle',
    observations: [],
    quality: null,
    params,
    computedAt: null,
    error: null,
  };
}

export function createEmptyGeometry(): Geometry {
  return {
    platformCenter: null,
    platformRadiusPx: null,
    holes: [],
    targetHoleId: null,
    proposedTargetHoleId: null,
    targetHoleConfirmedAt: null,
    pxPerCm: null,
    diameterCm: null,
    ringRotationDeg: null,
    source: null,
    templateSourceTrialId: null,
    confirmedAt: null,
    calibrationReviewAcknowledgedAt: null,
    detection: null,
  };
}

export function createEmptyTrialWindow(): TrialWindow {
  return {
    startTimeUs: null,
    endTimeUs: null,
    cutoffSeconds: DEFAULT_CUTOFF_SECONDS,
    source: 'manual',
    proposedStartTimeUs: null,
    proposedEndTimeUs: null,
    confirmedAt: null,
    motionOnsetConfidence: null,
    detectionFailureReason: null,
  };
}

export function createTrialStub(
  fingerprint: string,
  fileName: string,
): TrialRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    fingerprint,
    fileName,
    label: fileName.replace(/\.[^.]+$/, ''),
    ingestStatus: 'pending',
    ingestError: null,
    videoCached: false,
    metadata: null,
    timestampIndex: [],
    trialWindow: createEmptyTrialWindow(),
    geometry: createEmptyGeometry(),
    track: null,
    progress: {
      lastIngestAt: null,
      decodeWallClockMs: null,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function applyIngestResult(
  trial: TrialRecord,
  metadata: VideoMetadata,
  timestampIndex: TrialRecord['timestampIndex'],
  decodeWallClockMs: number,
): TrialRecord {
  const now = new Date().toISOString();
  const lastTimeUs = timestampIndex[timestampIndex.length - 1]?.timeUs ?? null;
  return {
    ...trial,
    ingestStatus: 'ready',
    ingestError: null,
    metadata,
    timestampIndex,
    trialWindow: {
      ...trial.trialWindow,
      proposedEndTimeUs: lastTimeUs,
      endTimeUs: trial.trialWindow.endTimeUs ?? lastTimeUs,
    },
    progress: {
      lastIngestAt: now,
      decodeWallClockMs,
    },
    updatedAt: now,
  };
}

export function markTrialNeedsReselect(trial: TrialRecord): TrialRecord {
  return {
    ...trial,
    videoCached: false,
    ingestStatus: trial.metadata ? 'needs_reselect' : trial.ingestStatus,
    updatedAt: new Date().toISOString(),
  };
}

export function markTrialVideoCached(trial: TrialRecord): TrialRecord {
  return {
    ...trial,
    videoCached: true,
    ingestStatus: trial.metadata && trial.ingestStatus === 'needs_reselect'
      ? 'ready'
      : trial.ingestStatus,
    updatedAt: new Date().toISOString(),
  };
}
