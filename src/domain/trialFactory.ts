import { DEFAULT_CUTOFF_SECONDS } from './constants';
import type { Geometry, TrialRecord, TrialWindow, VideoMetadata } from './types';

export const TOOL_VERSION = '0.2.0-ms2';

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
