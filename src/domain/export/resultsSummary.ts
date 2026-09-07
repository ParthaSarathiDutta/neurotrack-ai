import type { MeasureValue, TrialRecord } from '../types';
import { confirmedTargetHoleId } from '../events/holeProximity';
import { effectiveTrialStartUs } from '../events/holeProximity';
import { formatHoleDisplayId } from '../holeDisplay';
import { formatMeasureForDisplay } from './measureEncoding';
import { escapeEventFromList, escapeStateSummary } from './escapeSummary';

export interface ResultsSummaryRow {
  fileName: string;
  label: string;
  measurementBasis: string;
  targetStatus: string;
  targetHole: string;
  scaleStatus: string;
  physicalScale: string;
  escapeState: string;
  eventsReviewStatus: string;
  primaryLatency: string;
  totalLatency: string;
  primaryErrors: string;
  totalErrors: string;
  primaryErrorsConfirmedCount: string;
  primaryErrorsProvisionalCount: string;
  totalErrorsConfirmedCount: string;
  totalErrorsProvisionalCount: string;
  pathLength: string;
  meanSpeed: string;
  maxSpeed: string;
  meanSpeedDiagnostic: string;
  maxSpeedDiagnostic: string;
  targetQuadrantFraction: string;
  targetQuadrantTime: string;
  searchStrategy: string;
  searchStrategyOverride: string;
}

function formatErrorCountCell(measure: MeasureValue | undefined, count: number | null): string {
  if (!measure || measure.unavailable) {
    return measure?.unavailableReason ?? 'Unavailable';
  }
  if (count == null) return '—';
  return String(count);
}

function formatMeasureCell(measure: MeasureValue | undefined): string {
  if (!measure) return '—';
  return formatMeasureForDisplay(measure);
}

function formatReviewStatus(stale: boolean, staleReason: string | null): string {
  if (!stale) return 'Current';
  return staleReason ? `Stale — ${staleReason}` : 'Stale';
}

function formatPhysicalScale(pxPerCm: number | null, diameterCm: number | null): string {
  if (pxPerCm == null) return 'Unknown (coordinates in px)';
  const parts = [`${pxPerCm.toFixed(2)} px/cm`];
  if (diameterCm != null) parts.push(`platform Ø ${diameterCm.toFixed(1)} cm`);
  return parts.join('; ');
}

export function buildResultsSummaryRow(trial: TrialRecord): ResultsSummaryRow {
  const measures = trial.measures;
  const targetId = confirmedTargetHoleId(trial.geometry);
  const trialStart = effectiveTrialStartUs(trial.trialWindow);
  const events = trial.events?.events ?? [];
  const escapeEv = escapeEventFromList(events);

  return {
    fileName: trial.fileName,
    label: trial.label,
    measurementBasis: trial.measurementBasis,
    targetStatus: targetId != null ? 'confirmed' : 'unknown',
    targetHole: targetId != null ? formatHoleDisplayId(targetId) : 'Unknown',
    scaleStatus: trial.geometry.pxPerCm != null ? 'cm known' : 'unknown',
    physicalScale: formatPhysicalScale(trial.geometry.pxPerCm, trial.geometry.diameterCm),
    escapeState: escapeEv
      ? escapeStateSummary(escapeEv, measures, trialStart, targetId != null)
      : 'No escape event recorded',
    eventsReviewStatus: formatReviewStatus(trial.events?.stale ?? false, trial.events?.staleReason ?? null),
    primaryLatency: formatMeasureCell(measures?.primaryLatency),
    totalLatency: formatMeasureCell(measures?.totalLatency),
    primaryErrors: formatMeasureCell(measures?.primaryErrors),
    totalErrors: formatMeasureCell(measures?.totalErrors),
    primaryErrorsConfirmedCount: formatErrorCountCell(
      measures?.primaryErrors,
      measures?.primaryErrors?.unavailable ? null : (measures?.errorCounts.confirmed.total ?? null),
    ),
    primaryErrorsProvisionalCount: formatErrorCountCell(
      measures?.primaryErrors,
      measures?.primaryErrors?.unavailable ? null : (measures?.errorCounts.provisional.total ?? null),
    ),
    totalErrorsConfirmedCount: formatErrorCountCell(
      measures?.totalErrors,
      measures?.totalErrors?.unavailable ? null : (measures?.totalErrorCounts.confirmed.total ?? null),
    ),
    totalErrorsProvisionalCount: formatErrorCountCell(
      measures?.totalErrors,
      measures?.totalErrors?.unavailable ? null : (measures?.totalErrorCounts.provisional.total ?? null),
    ),
    pathLength: formatMeasureCell(measures?.pathLength),
    meanSpeed: formatMeasureCell(measures?.meanSpeed),
    maxSpeed: formatMeasureCell(measures?.maxSpeed),
    meanSpeedDiagnostic: formatMeasureCell(measures?.meanSpeedDiagnostic ?? undefined),
    maxSpeedDiagnostic: formatMeasureCell(measures?.maxSpeedDiagnostic ?? undefined),
    targetQuadrantFraction: formatMeasureCell(measures?.targetQuadrantFraction),
    targetQuadrantTime: formatMeasureCell(measures?.targetQuadrantTimeSec),
    searchStrategy: measures?.searchStrategy.classification ?? '—',
    searchStrategyOverride: measures?.searchStrategy.override ?? '—',
  };
}

export function buildResultsSummaryRows(trials: TrialRecord[]): ResultsSummaryRow[] {
  return trials.map(buildResultsSummaryRow);
}

export function resultsRowsToObjects(rows: ResultsSummaryRow[]): Record<string, string>[] {
  return rows.map((row) => ({ ...row }));
}
