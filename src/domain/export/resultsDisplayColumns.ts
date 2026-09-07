import type { ResultsSummaryRow } from './resultsSummary';

export interface ResultsDisplayColumn {
  key: keyof ResultsSummaryRow;
  header: string;
  width: number;
  wrap?: boolean;
}

/** Human-readable Results sheet columns — one row per trial, same data as resultsObjects. */
export const RESULTS_DISPLAY_COLUMNS: ResultsDisplayColumn[] = [
  { key: 'fileName', header: 'File name', width: 18 },
  { key: 'label', header: 'Label', width: 12 },
  { key: 'measurementBasis', header: 'Measurement basis', width: 16 },
  { key: 'targetStatus', header: 'Target status', width: 14 },
  { key: 'targetHole', header: 'Target hole', width: 12 },
  { key: 'scaleStatus', header: 'Scale status', width: 14 },
  { key: 'physicalScale', header: 'Physical scale', width: 24, wrap: true },
  { key: 'escapeState', header: 'Escape / outcome', width: 42, wrap: true },
  { key: 'eventsReviewStatus', header: 'Events review status', width: 18, wrap: true },
  { key: 'primaryLatency', header: 'Primary latency', width: 18, wrap: true },
  { key: 'totalLatency', header: 'Total latency', width: 16 },
  { key: 'primaryErrors', header: 'Primary errors', width: 18, wrap: true },
  { key: 'totalErrors', header: 'Total errors', width: 18, wrap: true },
  {
    key: 'primaryErrorsConfirmedCount',
    header: 'Primary errors — confirmed count',
    width: 16,
    wrap: true,
  },
  {
    key: 'primaryErrorsProvisionalCount',
    header: 'Primary errors — provisional count',
    width: 16,
    wrap: true,
  },
  {
    key: 'totalErrorsConfirmedCount',
    header: 'Total errors — confirmed count',
    width: 16,
    wrap: true,
  },
  {
    key: 'totalErrorsProvisionalCount',
    header: 'Total errors — provisional count',
    width: 16,
    wrap: true,
  },
  { key: 'pathLength', header: 'Path length', width: 14 },
  { key: 'meanSpeed', header: 'Mean speed', width: 14 },
  { key: 'maxSpeed', header: 'Max speed', width: 14 },
  { key: 'meanSpeedDiagnostic', header: 'Mean speed (diagnostic)', width: 18, wrap: true },
  { key: 'maxSpeedDiagnostic', header: 'Max speed (diagnostic)', width: 18, wrap: true },
  { key: 'targetQuadrantFraction', header: 'Target quadrant fraction', width: 18, wrap: true },
  { key: 'targetQuadrantTime', header: 'Target quadrant time', width: 18, wrap: true },
  { key: 'searchStrategy', header: 'Search strategy', width: 16 },
  { key: 'searchStrategyOverride', header: 'Strategy override', width: 16 },
];

export function resultsRowToDisplayValues(row: Record<string, string>): (string | number)[] {
  return RESULTS_DISPLAY_COLUMNS.map((col) => row[col.key] ?? '');
}

export function resultsDisplayHeaders(): string[] {
  return RESULTS_DISPLAY_COLUMNS.map((col) => col.header);
}
