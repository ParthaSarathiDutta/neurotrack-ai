import { useMemo } from 'react';
import type { TrialRecord } from '../domain/types';
import { useSessionStore } from '../store/sessionStore';
import { AnalysisBundleImport } from './AnalysisBundleImport';
import { buildSingleTrialExportData, buildSessionExportData } from '../domain/export/sessionExport';
import { buildSessionCsvFiles, buildCombinedCsvReport } from '../domain/export/csvExport';
import { buildSessionXlsxArrayBuffer } from '../domain/export/xlsxExport';
import {
  downloadArrayBuffer,
  downloadText,
  exportFileBaseName,
  sessionExportFileBaseName,
} from '../domain/export/download';
import { buildNeuroTrackBundle, bundleFileName, serializeNeuroTrackBundle } from '../domain/export/bundleExport';
import { formatMeasureForDisplay } from '../domain/export/measureEncoding';
import { escapeEventFromList, escapeStateSummary } from '../domain/export/escapeSummary';
import { confirmedTargetHoleId, effectiveTrialStartUs } from '../domain/events/holeProximity';
import styles from '../styles/app.module.css';

interface ResultsExportPanelProps {
  trial: TrialRecord;
  allTrials: TrialRecord[];
  showImportControls?: boolean;
}

export function ResultsExportPanel({
  trial,
  allTrials,
  showImportControls = true,
}: ResultsExportPanelProps) {
  const analysisParams = useSessionStore((s) => s.analysisParams);
  const selectedTrialId = useSessionStore((s) => s.selectedTrialId);
  const recomputeMeasuresFromEvents = useSessionStore((s) => s.recomputeMeasuresFromEvents);
  const exportableTrials = useMemo(
    () => allTrials.filter((t) => t.track?.status === 'done'),
    [allTrials],
  );

  const trialExport = useMemo(
    () => buildSingleTrialExportData(trial, analysisParams),
    [trial, analysisParams],
  );
  const sessionExport = useMemo(
    () => buildSessionExportData(exportableTrials, analysisParams),
    [exportableTrials, analysisParams],
  );

  const measures = trial.measures;
  const events = trial.events;
  const targetConfirmed = confirmedTargetHoleId(trial.geometry) != null;
  const trialStart = effectiveTrialStartUs(trial.trialWindow);
  const escapeEv = escapeEventFromList(events?.events ?? []);
  const speedPolicyStale =
    measures != null &&
    (measures.maxSpeed.definitionId === 'max_speed.v1' ||
      measures.meanSpeed.definitionId === 'mean_speed.v1');

  const handleExportTrialCsv = () => {
    const csv = buildCombinedCsvReport(buildSessionCsvFiles(trialExport));
    downloadText(csv, `${exportFileBaseName(trial.label, 'report')}.csv`);
  };

  const handleExportTrialXlsx = () => {
    const buffer = buildSessionXlsxArrayBuffer(trialExport);
    downloadArrayBuffer(
      buffer,
      `${exportFileBaseName(trial.label, 'report')}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  };

  const handleExportSessionCsv = () => {
    const csv = buildCombinedCsvReport(buildSessionCsvFiles(sessionExport));
    downloadText(csv, `${sessionExportFileBaseName(sessionExport.exportedAt)}.csv`);
  };

  const handleExportSessionXlsx = () => {
    const buffer = buildSessionXlsxArrayBuffer(sessionExport);
    downloadArrayBuffer(
      buffer,
      `${sessionExportFileBaseName(sessionExport.exportedAt)}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  };

  const handleExportBundle = () => {
    const bundle = buildNeuroTrackBundle(exportableTrials, analysisParams, selectedTrialId);
    downloadText(
      serializeNeuroTrackBundle(bundle),
      bundleFileName(bundle.exportedAt),
      'application/json;charset=utf-8',
    );
  };

  const trackIncomplete = trial.track?.status !== 'done';

  return (
    <section className={styles.panel} data-testid="results-export-panel">
      <h3>Results &amp; export</h3>

      {trackIncomplete && (
        <p className={styles.hint} data-testid="export-track-incomplete">
          Tracking must complete before export includes this trial.
        </p>
      )}

      {events?.stale && (
        <p className={styles.warning} data-testid="export-events-stale">
          Events stale: {events.staleReason ?? 'Re-detect events before relying on export.'}
        </p>
      )}

      {speedPolicyStale && (
        <p className={styles.warning} data-testid="speed-policy-stale">
          Speed measures use legacy v1 definitions — click &quot;Recompute measures from events&quot; to apply
          speed_interval_validity.v1 without re-detecting events.
        </p>
      )}

      <div data-testid="results-report" className={styles.resultsReport}>
        <h4>Results report — {trial.label}</h4>
        <dl className={styles.measureGrid}>
          <dt>Trial ID</dt>
          <dd>{trial.id}</dd>
          <dt>Measurement basis</dt>
          <dd>{trial.measurementBasis}</dd>
          <dt>Target</dt>
          <dd data-testid="report-target-status">
            {targetConfirmed ? `Confirmed (hole ${trial.geometry.targetHoleId! + 1})` : 'Unknown — target-dependent measures unavailable'}
          </dd>
          <dt>Scale</dt>
          <dd data-testid="report-scale-status">
            {trial.geometry.pxPerCm != null
              ? `${trial.geometry.pxPerCm.toFixed(3)} px/cm (${trial.geometry.diameterCm} cm diameter)`
              : 'Unknown — path/speed reported in px'}
          </dd>
          {escapeEv && (
            <>
              <dt>Escape state</dt>
              <dd data-testid="report-escape-state">
                {escapeStateSummary(escapeEv, measures, trialStart, targetConfirmed)}
              </dd>
            </>
          )}
        </dl>

        {measures ? (
          <>
            <h5>Measures ({measures.basisUsed})</h5>
            <dl className={styles.measureGrid}>
              <ReportMeasureRow label="Primary latency" testId="report-primary-latency" measure={measures.primaryLatency} />
              <ReportMeasureRow label="Total latency" testId="report-total-latency" measure={measures.totalLatency} />
              <ReportMeasureRow label="Primary errors (confirmed)" testId="report-primary-errors" measure={measures.primaryErrors} />
              <ReportMeasureRow label="Total errors (confirmed)" testId="report-total-errors" measure={measures.totalErrors} />
              <ReportMeasureRow label="Path length" testId="report-path-length" measure={measures.pathLength} />
              <ReportMeasureRow label="Mean speed" testId="report-mean-speed" measure={measures.meanSpeed} />
              <ReportMeasureRow label="Max speed" testId="report-max-speed" measure={measures.maxSpeed} />
              {measures.meanSpeedDiagnostic && (
                <ReportMeasureRow
                  label="Mean speed (diagnostic)"
                  testId="report-mean-speed-diagnostic"
                  measure={measures.meanSpeedDiagnostic}
                />
              )}
              {measures.maxSpeedDiagnostic && (
                <ReportMeasureRow
                  label="Max speed (diagnostic)"
                  testId="report-max-speed-diagnostic"
                  measure={measures.maxSpeedDiagnostic}
                />
              )}
              {measures.maxSpeed.assumptions.some((a) => a.startsWith('excluded_timestamp_compression:')) && (
                <>
                  <dt>Speed interval exclusions</dt>
                  <dd data-testid="report-speed-exclusions" className={styles.diagnosticNote}>
                    {measures.maxSpeed.assumptions
                      .filter(
                        (a) =>
                          a.startsWith('excluded_timestamp_compression:') ||
                          a.startsWith('speed_interval_validity'),
                      )
                      .join(' · ')}
                  </dd>
                </>
              )}
              <ReportMeasureRow label="Target quadrant fraction" testId="report-quadrant-fraction" measure={measures.targetQuadrantFraction} />
              <ReportMeasureRow label="Target quadrant time" testId="report-quadrant-time" measure={measures.targetQuadrantTimeSec} />
              <dt>Search strategy</dt>
              <dd data-testid="report-search-strategy">
                {measures.searchStrategy.override ?? measures.searchStrategy.classification}
                {measures.searchStrategy.overrideReason
                  ? ` — ${measures.searchStrategy.overrideReason}`
                  : ''}
              </dd>
            </dl>
            <p className={styles.hint}>
              Provisional errors — primary: {measures.errorCounts.provisional.total}, total:{' '}
              {measures.totalErrorCounts.provisional.total}
            </p>
          </>
        ) : (
          <p data-testid="report-no-measures">No measures computed — detect events first.</p>
        )}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          data-testid="export-csv-btn"
          disabled={trackIncomplete}
          onClick={handleExportTrialCsv}
        >
          Download CSV (this trial)
        </button>
        <button
          type="button"
          className={styles.button}
          data-testid="export-xlsx-btn"
          disabled={trackIncomplete}
          onClick={handleExportTrialXlsx}
        >
          Download XLSX (this trial)
        </button>
        {exportableTrials.length > 1 && (
          <>
            <button
              type="button"
              className={styles.button}
              data-testid="export-session-csv-btn"
              onClick={handleExportSessionCsv}
            >
              Download CSV (session, {exportableTrials.length} trials)
            </button>
            <button
              type="button"
              className={styles.button}
              data-testid="export-session-xlsx-btn"
              onClick={handleExportSessionXlsx}
            >
              Download XLSX (session, {exportableTrials.length} trials)
            </button>
          </>
        )}
        <button
          type="button"
          className={styles.button}
          data-testid="export-bundle-btn"
          disabled={exportableTrials.length === 0}
          onClick={handleExportBundle}
        >
          Download analysis bundle
        </button>
        {showImportControls && <AnalysisBundleImport />}
        {trial.events && (
          <button
            type="button"
            className={styles.button}
            data-testid="recompute-measures-btn"
            onClick={() => recomputeMeasuresFromEvents(trial.id)}
          >
            Recompute measures from events
          </button>
        )}
      </div>
    </section>
  );
}

function ReportMeasureRow({
  label,
  testId,
  measure,
}: {
  label: string;
  testId: string;
  measure: { definitionSummary: string } & Parameters<typeof formatMeasureForDisplay>[0];
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd data-testid={testId} title={measure.definitionSummary}>
        {formatMeasureForDisplay(measure)}
      </dd>
    </>
  );
}
