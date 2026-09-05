import type { Geometry, Hole, TrialRecord, TrialWindow } from './types';

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
