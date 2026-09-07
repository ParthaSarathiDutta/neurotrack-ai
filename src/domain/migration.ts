import type { AnalysisParams, EventAnalysis, Geometry, Hole, Track, TrialRecord, TrialWindow } from './types';
import { BODY_ENTRY_DEFINITION_VERSION } from './events/bodyEntry';
import {
  defaultCleaningParams,
  defaultEventDetectionParams,
  defaultMeasurementBasis,
  defaultOperationalDefinitions,
  defaultTrackingParams,
} from './trialFactory';

export type TrialReviewStatus =
  | 'needs_review'
  | 'geometry_confirmed'
  | 'window_confirmed'
  | 'ready';

export function getTrialReviewStatus(trial: TrialRecord): TrialReviewStatus {
  const geoConfirmed = Boolean(trial.geometry.confirmedAt);
  const targetConfirmed = Boolean(trial.geometry.targetHoleConfirmedAt);
  const windowConfirmed = Boolean(trial.trialWindow.confirmedAt);

  if (geoConfirmed && targetConfirmed && windowConfirmed) return 'ready';
  if (geoConfirmed && targetConfirmed) return 'geometry_confirmed';
  if (windowConfirmed) return 'window_confirmed';
  return 'needs_review';
}

export function reviewStatusLabel(status: TrialReviewStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready for tracking';
    case 'geometry_confirmed':
      return 'Geometry confirmed';
    case 'window_confirmed':
      return 'Window confirmed';
    default:
      return 'Needs review';
  }
}

/** Migrate MS-1 trial records to MS-2 shape. */
export function migrateTrialRecord(trial: TrialRecord): TrialRecord {
  return {
    ...trial,
    geometry: migrateGeometry(trial.geometry),
    trialWindow: migrateTrialWindow(trial.trialWindow),
    track: migrateTrack(trial.track),
    events: migrateEventAnalysis(trial.events),
    measures: trial.measures ?? null,
    measurementBasis: trial.measurementBasis ?? defaultMeasurementBasis(),
  };
}

function migrateEventAnalysis(events: EventAnalysis | null | undefined): EventAnalysis | null {
  if (!events) return null;
  const autoEsc = events.events.find((e) => e.type !== 'investigation' && e.origin === 'auto');
  if (!autoEsc) return events;

  const version = autoEsc.evidence.bodyEntryDefinitionVersion;
  const completionPath = autoEsc.evidence.bodyEntryCompletionPath;
  const supersededVersion =
    version != null && String(version) !== BODY_ENTRY_DEFINITION_VERSION;
  const supersededOcclusionAutoComplete =
    autoEsc.type === 'escape_completed' &&
    autoEsc.origin === 'auto' &&
    autoEsc.status === 'proposed' &&
    completionPath === 'occlusion_pixel';

  if (supersededVersion || supersededOcclusionAutoComplete) {
    return {
      ...events,
      stale: true,
      staleReason: supersededVersion
        ? `Body-entry definition v${BODY_ENTRY_DEFINITION_VERSION} supersedes stored v${String(version)} — re-detect events to refresh automatic escape and measures.`
        : 'Occlusion-path auto-completion superseded — re-detect events (Path B is evidence only in v3).',
    };
  }
  return events;
}

function migrateTrack(track: Track | null | undefined): Track | null {
  if (!track) return null;
  const appliedCleaning = track.appliedCleaning
    ? {
        ...track.appliedCleaning,
        params: {
          ...defaultCleaningParams(),
          ...track.appliedCleaning.params,
          maxGapDurationUs:
            track.appliedCleaning.params.maxGapDurationUs ??
            defaultCleaningParams().maxGapDurationUs,
        },
        stale: track.appliedCleaning.stale ?? false,
        staleReason: track.appliedCleaning.staleReason ?? null,
      }
    : null;
  return {
    status: track.status ?? 'idle',
    observations: track.observations ?? [],
    manualCorrections: track.manualCorrections ?? [],
    appliedCleaning,
    quality: track.quality ?? null,
    params: { ...defaultTrackingParams(), ...track.params },
    computedAt: track.computedAt ?? null,
    error: track.error ?? null,
  };
}

export function migrateAnalysisParams(params: AnalysisParams): AnalysisParams {
  const cleaning = { ...defaultCleaningParams(), ...params.cleaning };
  if (params.cleaning?.maxGapDurationUs == null) {
    cleaning.maxGapDurationUs = defaultCleaningParams().maxGapDurationUs;
  }
  return {
    ...params,
    tracking: params.tracking ?? defaultTrackingParams(),
    cleaning,
    events: { ...defaultEventDetectionParams(), ...params.events },
    operationalDefinitions: {
      ...defaultOperationalDefinitions(),
      ...params.operationalDefinitions,
    },
    measurementBasisDefault: params.measurementBasisDefault ?? defaultMeasurementBasis(),
  };
}

function migrateGeometry(geo: Geometry): Geometry {
  const holes: Hole[] = (geo.holes ?? []).map((h, i) => ({
    id: h.id ?? i,
    x: h.x,
    y: h.y,
    source: 'source' in h && h.source ? (h as Hole).source : 'manual',
    confidence: 'confidence' in h ? (h as Hole).confidence : null,
  }));

  return {
    platformCenter: geo.platformCenter ?? null,
    platformRadiusPx: geo.platformRadiusPx ?? null,
    holes,
    targetHoleId: geo.targetHoleId ?? null,
    proposedTargetHoleId: geo.proposedTargetHoleId ?? null,
    targetHoleConfirmedAt: geo.targetHoleConfirmedAt ?? null,
    pxPerCm: geo.pxPerCm ?? null,
    diameterCm: geo.diameterCm ?? null,
    ringRotationDeg: geo.ringRotationDeg ?? null,
    source: geo.source ?? null,
    templateSourceTrialId: geo.templateSourceTrialId ?? null,
    confirmedAt: geo.confirmedAt ?? null,
    calibrationReviewAcknowledgedAt: geo.calibrationReviewAcknowledgedAt ?? null,
    detection: geo.detection ?? null,
  };
}

function migrateTrialWindow(tw: TrialWindow): TrialWindow {
  return {
    startTimeUs: tw.startTimeUs ?? null,
    endTimeUs: tw.endTimeUs ?? null,
    cutoffSeconds: tw.cutoffSeconds ?? null,
    source: tw.source ?? 'manual',
    proposedStartTimeUs: tw.proposedStartTimeUs ?? null,
    proposedEndTimeUs: tw.proposedEndTimeUs ?? null,
    confirmedAt: tw.confirmedAt ?? null,
    motionOnsetConfidence: tw.motionOnsetConfidence ?? null,
    detectionFailureReason: tw.detectionFailureReason ?? null,
  };
}
