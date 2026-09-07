import {
  CLEANING_MAX_GAP_DURATION_US_DEFAULT,
  CLEANING_MAX_GAP_FRAMES_DEFAULT,
  CLEANING_OUTLIER_SPEED_MULTIPLIER_DEFAULT,
  CLEANING_SMOOTHING_WINDOW_DEFAULT,
  EVENT_BODY_ENTRY_HOLE_DARKENING_MIN,
  EVENT_BODY_ENTRY_PLATFORM_AREA_MAX_FRACTION,
  EVENT_BODY_ENTRY_TEMPORAL_MIN_FRAMES,
  EVENT_BODY_ENTRY_DARKENING_PROGRESS_EPS,
  EVENT_BODY_ENTRY_AREA_PROGRESS_PX,
  EVENT_BODY_ENTRY_TORSO_PROXIMITY_FRACTION,
  EVENT_ESCAPE_CENSOR_THRESHOLD,
  EVENT_ESCAPE_COMPLETION_AREA_RATIO,
  EVENT_ESCAPE_CONFIRM_THRESHOLD,
  EVENT_ESCAPE_MOTION_DECAY_RATIO,
  EVENT_ESCAPE_PROXIMITY_FRACTION,
  EVENT_ESCAPE_PROXIMITY_MIN_SPAN_US,
  EVENT_INVESTIGATION_BODY_PROXIMITY_FRACTION,
  EVENT_INVESTIGATION_MERGE_GAP_US,
  EVENT_INVESTIGATION_MIN_DWELL_US,
  EVENT_INVESTIGATION_NOSE_PROXIMITY_FRACTION,
  EVENT_PIXEL_EVIDENCE_BUDGET_FRAMES,
  EVENT_STRATEGY_CENTER_CROSSING_THRESHOLD,
  EVENT_STRATEGY_DI_THRESHOLD,
  EVENT_STRATEGY_MAX_DISTINCT_HOLES_BEFORE_TARGET,
  EVENT_STRATEGY_MAX_SERIAL_VIOLATIONS,
  EVENT_STRATEGY_MIN_SERIAL_HOLES,
  EVENT_STRATEGY_NONCENTRAL_START_FLAG_FRACTION,
  TRACKING_BACKGROUND_SAMPLE_COUNT,
  TRACKING_LOW_CONFIDENCE_THRESHOLD,
  TRACKING_MAX_BLOB_AREA_FRACTION,
  TRACKING_MAX_PLAUSIBLE_SPEED_PX_PER_SEC,
  TRACKING_MIN_BLOB_AREA_FRACTION,
} from './constants';
import type {
  CleaningParams,
  EventDetectionParams,
  Geometry,
  MeasurementBasis,
  OperationalDefinitionSelections,
  TrialRecord,
  TrialWindow,
  Track,
  TrackingParams,
  VideoMetadata,
} from './types';

export const TOOL_VERSION = '0.5.0-ms5';

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

export function defaultEventDetectionParams(): EventDetectionParams {
  return {
    investigationNoseProximityFraction: EVENT_INVESTIGATION_NOSE_PROXIMITY_FRACTION,
    investigationBodyProximityFraction: EVENT_INVESTIGATION_BODY_PROXIMITY_FRACTION,
    investigationMinDwellUs: EVENT_INVESTIGATION_MIN_DWELL_US,
    investigationMergeGapUs: EVENT_INVESTIGATION_MERGE_GAP_US,
    escapeProximityFraction: EVENT_ESCAPE_PROXIMITY_FRACTION,
    escapeMotionDecayRatio: EVENT_ESCAPE_MOTION_DECAY_RATIO,
    escapeProximityMinSpanUs: EVENT_ESCAPE_PROXIMITY_MIN_SPAN_US,
    escapeConfirmThreshold: EVENT_ESCAPE_CONFIRM_THRESHOLD,
    escapeCensorThreshold: EVENT_ESCAPE_CENSOR_THRESHOLD,
    escapeCompletionAreaRatio: EVENT_ESCAPE_COMPLETION_AREA_RATIO,
    pixelEvidenceBudgetFrames: EVENT_PIXEL_EVIDENCE_BUDGET_FRAMES,
    bodyEntryTorsoProximityFraction: EVENT_BODY_ENTRY_TORSO_PROXIMITY_FRACTION,
    bodyEntryHoleDarkeningMin: EVENT_BODY_ENTRY_HOLE_DARKENING_MIN,
    bodyEntryPlatformAreaMaxFraction: EVENT_BODY_ENTRY_PLATFORM_AREA_MAX_FRACTION,
    bodyEntryTemporalMinFrames: EVENT_BODY_ENTRY_TEMPORAL_MIN_FRAMES,
    bodyEntryDarkeningProgressEps: EVENT_BODY_ENTRY_DARKENING_PROGRESS_EPS,
    bodyEntryAreaProgressPx: EVENT_BODY_ENTRY_AREA_PROGRESS_PX,
    strategyDiThreshold: EVENT_STRATEGY_DI_THRESHOLD,
    strategyMaxDistinctHolesBeforeTarget: EVENT_STRATEGY_MAX_DISTINCT_HOLES_BEFORE_TARGET,
    strategyMinSerialHoles: EVENT_STRATEGY_MIN_SERIAL_HOLES,
    strategyMaxSerialViolations: EVENT_STRATEGY_MAX_SERIAL_VIOLATIONS,
    strategyCenterCrossingThreshold: EVENT_STRATEGY_CENTER_CROSSING_THRESHOLD,
    strategyNoncentralStartFlagFraction: EVENT_STRATEGY_NONCENTRAL_START_FLAG_FRACTION,
    toolVersion: TOOL_VERSION,
  };
}

export function defaultOperationalDefinitions(): OperationalDefinitionSelections {
  return {
    primaryLatencyVariant: 'first_target_investigation',
    quadrantConvention: 'target_centered_90',
    quadrantNorthDeg: null,
  };
}

export function defaultMeasurementBasis(): MeasurementBasis {
  return 'corrected';
}

export function defaultCleaningParams(): CleaningParams {
  return {
    maxGapFrames: CLEANING_MAX_GAP_FRAMES_DEFAULT,
    maxGapDurationUs: CLEANING_MAX_GAP_DURATION_US_DEFAULT,
    smoothingWindow: CLEANING_SMOOTHING_WINDOW_DEFAULT,
    outlierSpeedMultiplier: CLEANING_OUTLIER_SPEED_MULTIPLIER_DEFAULT,
    toolVersion: TOOL_VERSION,
  };
}

export function createEmptyTrack(params: TrackingParams = defaultTrackingParams()): Track {
  return {
    status: 'idle',
    observations: [],
    manualCorrections: [],
    appliedCleaning: null,
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
    cutoffSeconds: null,
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
    events: null,
    measures: null,
    measurementBasis: defaultMeasurementBasis(),
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
