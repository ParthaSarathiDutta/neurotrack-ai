import type { AnalysisParams, TrialRecord } from '../types';
import { escapeEventFromList, escapeStateSummary } from './escapeSummary';
import { confirmedTargetHoleId, effectiveTrialStartUs } from '../events/holeProximity';
import {
  BUNDLE_SCHEMA_VERSION,
  BUNDLE_TYPE,
  type BundleTrialEntry,
  type NeuroTrackBundle,
} from './bundleSchema';

function buildExportProvenance(trial: TrialRecord): BundleTrialEntry['exportProvenance'] {
  const events = trial.events?.events ?? [];
  const targetConfirmed = confirmedTargetHoleId(trial.geometry) != null;
  const trialStart = effectiveTrialStartUs(trial.trialWindow);
  const escapeEv = escapeEventFromList(events);

  return {
    measurementBasis: trial.measurementBasis,
    eventReviewCounts: {
      proposed: events.filter((e) => e.status === 'proposed').length,
      confirmed: events.filter((e) => e.status === 'confirmed').length,
      rejected: events.filter((e) => e.status === 'rejected').length,
      manual: events.filter((e) => e.origin === 'manual').length,
    },
    escapeState: escapeEv
      ? escapeStateSummary(escapeEv, trial.measures, trialStart, targetConfirmed)
      : null,
    cleaningStale: trial.track?.appliedCleaning?.stale ?? false,
    eventsStale: trial.events?.stale ?? false,
  };
}

function sanitizeTrialForExport(trial: TrialRecord): TrialRecord {
  return {
    ...trial,
    videoCached: false,
  };
}

/**
 * Read-only bundle export. Does not mutate input trials, re-track, re-detect, or recompute measures.
 */
export function buildNeuroTrackBundle(
  trials: TrialRecord[],
  analysisParams: AnalysisParams,
  selectedTrialId: string | null,
  exportedAt: string = new Date().toISOString(),
): NeuroTrackBundle {
  const exportableTrials = trials.filter((t) => t.track?.status === 'done');

  const entries: BundleTrialEntry[] = exportableTrials.map((trial) => {
    const sanitized = sanitizeTrialForExport(trial);
    return {
      trial: sanitized,
      videoIdentity: {
        fingerprint: trial.fingerprint,
        fileName: trial.fileName,
        durationSec: trial.metadata?.durationSec ?? null,
        nbSamples: trial.metadata?.nbSamples ?? null,
        containerFrameRateLabel: trial.metadata?.containerFrameRateLabel ?? null,
      },
      exportProvenance: buildExportProvenance(trial),
    };
  });

  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    bundleType: BUNDLE_TYPE,
    exportedAt,
    toolVersion: analysisParams.toolVersion,
    analysisParams,
    selectedTrialId,
    trials: entries,
  };
}

export function serializeNeuroTrackBundle(bundle: NeuroTrackBundle): string {
  return JSON.stringify(bundle);
}

export function bundleFileName(exportedAt: string): string {
  const stamp = exportedAt.replace(/[:.]/g, '-');
  return `neurotrack_session_${stamp}.neurotrack.json`;
}
