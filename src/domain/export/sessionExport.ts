import type { AnalysisParams, TrialRecord } from '../types';
import { buildTrialSummaryRows, summaryRowsToObjects } from './trialSummary';
import { buildEventExportRows, eventRowsToObjects } from './eventsTable';
import { buildParameterRows, parameterRowsToObjects } from './parametersTable';
import {
  buildOperationalDefinitionRows,
  operationalDefinitionRowsToObjects,
} from './operationalDefinitions';
import { buildProvenanceRows, provenanceRowsToObjects } from './provenanceSummary';
import { buildResultsSummaryRows, resultsRowsToObjects } from './resultsSummary';

export interface SessionExportData {
  exportedAt: string;
  toolVersion: string;
  trialCount: number;
  summaryRows: ReturnType<typeof buildTrialSummaryRows>;
  summaryObjects: Record<string, string | number | boolean | null>[];
  resultsObjects: Record<string, string>[];
  eventObjects: Record<string, string | number | boolean | null>[];
  parameterObjects: Record<string, string | number | boolean | null>[];
  operationalDefinitionObjects: Record<string, string | null>[];
  provenanceObjects: Record<string, string | number | boolean | null>[];
}

/**
 * Read-only session serialization for export.
 * Does not invoke detectEvents, tracking, or mutate trial state.
 */
export function buildSessionExportData(
  trials: TrialRecord[],
  analysisParams: AnalysisParams,
  exportedAt: string = new Date().toISOString(),
): SessionExportData {
  const exportableTrials = trials.filter((t) => t.track?.status === 'done');

  const summaryRows = buildTrialSummaryRows(exportableTrials);
  const resultsObjects = resultsRowsToObjects(buildResultsSummaryRows(exportableTrials));
  const eventObjects = exportableTrials.flatMap((trial) =>
    eventRowsToObjects(
      buildEventExportRows(trial.id, trial.events?.events ?? [], trial.geometry),
    ),
  );
  const parameterObjects = parameterRowsToObjects(buildParameterRows(analysisParams, exportedAt));
  const operationalDefinitionObjects = operationalDefinitionRowsToObjects(
    buildOperationalDefinitionRows(analysisParams),
  );
  const provenanceObjects = provenanceRowsToObjects(buildProvenanceRows(exportableTrials));

  return {
    exportedAt,
    toolVersion: analysisParams.toolVersion,
    trialCount: exportableTrials.length,
    summaryRows,
    summaryObjects: summaryRowsToObjects(summaryRows),
    resultsObjects,
    eventObjects,
    parameterObjects,
    operationalDefinitionObjects,
    provenanceObjects,
  };
}

export function buildSingleTrialExportData(
  trial: TrialRecord,
  analysisParams: AnalysisParams,
  exportedAt?: string,
): SessionExportData {
  return buildSessionExportData([trial], analysisParams, exportedAt);
}
