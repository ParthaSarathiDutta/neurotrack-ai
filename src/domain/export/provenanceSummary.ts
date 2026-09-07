import type { TrialRecord } from '../types';
import { escapeEventFromList, escapeStateSummary } from './escapeSummary';
import { confirmedTargetHoleId, effectiveTrialStartUs } from '../events/holeProximity';

export interface ProvenanceRow {
  trialId: string;
  fileName: string;
  trackStatus: string | null;
  observationCount: number;
  manualCorrectionCount: number;
  appliedCleaningPresent: boolean;
  appliedCleaningStale: boolean;
  appliedCleaningStaleReason: string | null;
  eventsStale: boolean;
  eventsStaleReason: string | null;
  eventCountTotal: number;
  eventCountProposed: number;
  eventCountConfirmed: number;
  eventCountRejected: number;
  eventCountManual: number;
  investigationCount: number;
  escapeStateLabel: string | null;
  searchStrategyOverride: string | null;
  searchStrategyOverrideReason: string | null;
  measurementBasis: string;
  measuresBasisUsed: string | null;
}

export function buildProvenanceRow(trial: TrialRecord): ProvenanceRow {
  const events = trial.events?.events ?? [];
  const targetConfirmed = confirmedTargetHoleId(trial.geometry) != null;
  const trialStart = effectiveTrialStartUs(trial.trialWindow);
  const escapeEv = escapeEventFromList(events);

  return {
    trialId: trial.id,
    fileName: trial.fileName,
    trackStatus: trial.track?.status ?? null,
    observationCount: trial.track?.observations.length ?? 0,
    manualCorrectionCount: trial.track?.manualCorrections.length ?? 0,
    appliedCleaningPresent: trial.track?.appliedCleaning != null,
    appliedCleaningStale: trial.track?.appliedCleaning?.stale ?? false,
    appliedCleaningStaleReason: trial.track?.appliedCleaning?.staleReason ?? null,
    eventsStale: trial.events?.stale ?? false,
    eventsStaleReason: trial.events?.staleReason ?? null,
    eventCountTotal: events.length,
    eventCountProposed: events.filter((e) => e.status === 'proposed').length,
    eventCountConfirmed: events.filter((e) => e.status === 'confirmed').length,
    eventCountRejected: events.filter((e) => e.status === 'rejected').length,
    eventCountManual: events.filter((e) => e.origin === 'manual').length,
    investigationCount: events.filter((e) => e.type === 'investigation').length,
    escapeStateLabel: escapeEv
      ? escapeStateSummary(escapeEv, trial.measures, trialStart, targetConfirmed)
      : null,
    searchStrategyOverride: trial.measures?.searchStrategy.override ?? null,
    searchStrategyOverrideReason: trial.measures?.searchStrategy.overrideReason ?? null,
    measurementBasis: trial.measurementBasis,
    measuresBasisUsed: trial.measures?.basisUsed ?? null,
  };
}

export function buildProvenanceRows(trials: TrialRecord[]): ProvenanceRow[] {
  return trials.map(buildProvenanceRow);
}

export const PROVENANCE_COLUMNS: (keyof ProvenanceRow)[] = [
  'trialId',
  'fileName',
  'trackStatus',
  'observationCount',
  'manualCorrectionCount',
  'appliedCleaningPresent',
  'appliedCleaningStale',
  'appliedCleaningStaleReason',
  'eventsStale',
  'eventsStaleReason',
  'eventCountTotal',
  'eventCountProposed',
  'eventCountConfirmed',
  'eventCountRejected',
  'eventCountManual',
  'investigationCount',
  'escapeStateLabel',
  'searchStrategyOverride',
  'searchStrategyOverrideReason',
  'measurementBasis',
  'measuresBasisUsed',
];

export function provenanceRowsToObjects(rows: ProvenanceRow[]): Record<string, string | number | boolean | null>[] {
  return rows.map((row) => ({ ...row }));
}
