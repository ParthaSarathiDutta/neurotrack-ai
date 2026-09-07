import type { TrialRecord } from '../types';
import { confirmedTargetHoleId } from '../events/holeProximity';
import { effectiveTrialStartUs } from '../events/holeProximity';
import { formatPresentationTimeSeconds } from '../timing';
import { formatHoleDisplayId } from '../holeDisplay';
import {
  encodeMeasureValue,
  encodeSearchStrategy,
  flattenEncodedMeasure,
} from './measureEncoding';
import { escapeEventFromList, escapeStateSummary } from './escapeSummary';

export interface TrialSummaryRow {
  trialId: string;
  fileName: string;
  label: string;
  fingerprint: string;
  measurementBasis: string;
  targetStatus: 'confirmed' | 'unknown';
  targetHoleDisplay: string | null;
  scaleStatus: 'cm' | 'unknown';
  pxPerCm: number | null;
  platformDiameterCm: number | null;
  trialWindowStartSec: string | null;
  trialWindowEndSec: string | null;
  cutoffSeconds: number | null;
  trackStatus: string | null;
  eventsComputedAt: string | null;
  measuresComputedAt: string | null;
  eventsStale: boolean;
  eventsStaleReason: string | null;
  escapeStateSummary: string | null;
  searchStrategyClassification: string | null;
  searchStrategyOverride: string | null;
  primaryErrorsConfirmed: number | null;
  primaryErrorsProvisional: number | null;
  totalErrorsConfirmed: number | null;
  totalErrorsProvisional: number | null;
  [key: string]: string | number | boolean | null | undefined;
}

export function buildTrialSummaryRow(trial: TrialRecord): TrialSummaryRow {
  const targetId = confirmedTargetHoleId(trial.geometry);
  const trialStart = effectiveTrialStartUs(trial.trialWindow);
  const measures = trial.measures;
  const events = trial.events?.events ?? [];
  const escapeEv = escapeEventFromList(events);

  const row: TrialSummaryRow = {
    trialId: trial.id,
    fileName: trial.fileName,
    label: trial.label,
    fingerprint: trial.fingerprint,
    measurementBasis: trial.measurementBasis,
    targetStatus: targetId != null ? 'confirmed' : 'unknown',
    targetHoleDisplay: targetId != null ? formatHoleDisplayId(targetId) : null,
    scaleStatus: trial.geometry.pxPerCm != null ? 'cm' : 'unknown',
    pxPerCm: trial.geometry.pxPerCm,
    platformDiameterCm: trial.geometry.diameterCm,
    trialWindowStartSec:
      trial.trialWindow.startTimeUs != null
        ? formatPresentationTimeSeconds(trial.trialWindow.startTimeUs)
        : null,
    trialWindowEndSec:
      trial.trialWindow.endTimeUs != null
        ? formatPresentationTimeSeconds(trial.trialWindow.endTimeUs)
        : null,
    cutoffSeconds: trial.trialWindow.cutoffSeconds,
    trackStatus: trial.track?.status ?? null,
    eventsComputedAt: trial.events?.computedAt ?? null,
    measuresComputedAt: measures?.computedAt ?? null,
    eventsStale: trial.events?.stale ?? false,
    eventsStaleReason: trial.events?.staleReason ?? null,
    escapeStateSummary: escapeEv
      ? escapeStateSummary(escapeEv, measures, trialStart, targetId != null)
      : null,
    searchStrategyClassification: measures?.searchStrategy.classification ?? null,
    searchStrategyOverride: measures?.searchStrategy.override ?? null,
    primaryErrorsConfirmed: measures?.errorCounts.confirmed.total ?? null,
    primaryErrorsProvisional: measures?.errorCounts.provisional.total ?? null,
    totalErrorsConfirmed: measures?.totalErrorCounts.confirmed.total ?? null,
    totalErrorsProvisional: measures?.totalErrorCounts.provisional.total ?? null,
  };

  if (measures) {
    const measureEntries: [string, ReturnType<typeof encodeMeasureValue>][] = [
      ['primaryLatency', encodeMeasureValue('primaryLatency', measures.primaryLatency)],
      ['totalLatency', encodeMeasureValue('totalLatency', measures.totalLatency)],
      ['primaryErrors', encodeMeasureValue('primaryErrors', measures.primaryErrors)],
      ['totalErrors', encodeMeasureValue('totalErrors', measures.totalErrors)],
      ['pathLength', encodeMeasureValue('pathLength', measures.pathLength)],
      ['meanSpeed', encodeMeasureValue('meanSpeed', measures.meanSpeed)],
      ['maxSpeed', encodeMeasureValue('maxSpeed', measures.maxSpeed)],
      ['targetQuadrantFraction', encodeMeasureValue('targetQuadrantFraction', measures.targetQuadrantFraction)],
      ['targetQuadrantTimeSec', encodeMeasureValue('targetQuadrantTimeSec', measures.targetQuadrantTimeSec)],
    ];
    for (const [prefix, encoded] of measureEntries) {
      Object.assign(row, flattenEncodedMeasure(prefix, encoded));
    }
    const strategy = encodeSearchStrategy(measures.searchStrategy);
    row.searchStrategy_valueKind = strategy.valueKind;
    row.searchStrategy_classification = strategy.classification;
    row.searchStrategy_override = strategy.override;
    row.searchStrategy_overrideReason = strategy.overrideReason;
    row.searchStrategy_classifierVersion = strategy.classifierVersion;
    row.searchStrategy_reasoning = strategy.reasoning;
  }

  return row;
}

export function buildTrialSummaryRows(trials: TrialRecord[]): TrialSummaryRow[] {
  return trials.map(buildTrialSummaryRow);
}

export function summaryRowsToObjects(rows: TrialSummaryRow[]): Record<string, string | number | boolean | null>[] {
  return rows.map((row) => {
    const out: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(row)) {
      if (v !== undefined) out[k] = v as string | number | boolean | null;
    }
    return out;
  });
}
