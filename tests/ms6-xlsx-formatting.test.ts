import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSessionExportData } from '../src/domain/export/sessionExport';
import { buildSessionXlsxArrayBuffer, readEventsSheetRows, readResultsDisplayRows, readXlsxSheetRows } from '../src/domain/export/xlsxExport';
import {
  hasAutoFilter,
  hasCustomColumnWidths,
  hasFrozenPane,
  hasHeaderFill,
  hasStyledHeaderCells,
  hasWrapTextStyles,
  hasWrappedDataCells,
  inspectSavedXlsx,
} from './helpers/xlsxFormattingInspect';
import { resultsDisplayHeaders } from '../src/domain/export/resultsDisplayColumns';
import {
  defaultEventDetectionParams,
  defaultOperationalDefinitions,
  defaultTrackingParams,
  TOOL_VERSION,
} from '../src/domain/trialFactory';
import type { AnalysisParams, TrialRecord } from '../src/domain/types';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'ms6');

const analysisParams: AnalysisParams = {
  id: 'default',
  toolVersion: TOOL_VERSION,
  tracking: defaultTrackingParams(),
  cleaning: {
    maxGapFrames: 3,
    maxGapDurationUs: 500_000,
    smoothingWindow: 3,
    outlierSpeedMultiplier: 2,
    toolVersion: TOOL_VERSION,
  },
  events: defaultEventDetectionParams(),
  operationalDefinitions: defaultOperationalDefinitions(),
  measurementBasisDefault: 'corrected',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function bundleAnalysisParams(bundle: { analysisParams?: AnalysisParams }): AnalysisParams {
  return {
    ...analysisParams,
    ...bundle.analysisParams,
    toolVersion: TOOL_VERSION,
  };
}

function loadThreeTrialExport() {
  const fixture = JSON.parse(readFileSync(join(FIXTURES, 'three-trial-session.neurotrack.json'), 'utf8'));
  const trials = fixture.trials.map((entry: { trial: TrialRecord }) => entry.trial);
  return buildSessionExportData(trials, bundleAnalysisParams(fixture), fixture.exportedAt);
}

describe('MS-6 XLSX formatting serialization', () => {
  it('writes human-readable Results headers with freeze panes, filters, widths, and styles', async () => {
    const fixture = JSON.parse(readFileSync(join(FIXTURES, 'export_unknown_target.json'), 'utf8'));
    const data = buildSessionExportData([fixture.trial as TrialRecord], analysisParams);
    const buffer = await buildSessionXlsxArrayBuffer(data);
    const fmt = inspectSavedXlsx(buffer);

    expect(hasFrozenPane(fmt.resultsXml)).toBe(true);
    expect(hasCustomColumnWidths(fmt.resultsXml)).toBe(true);
    expect(hasAutoFilter(fmt.resultsXml, 'A1:Z2')).toBe(true);
    expect(hasWrapTextStyles(fmt.stylesXml)).toBe(true);
    expect(hasHeaderFill(fmt.stylesXml)).toBe(true);
    expect(hasStyledHeaderCells(fmt.resultsXml)).toBe(true);
    expect(fmt.sharedStringsXml).toContain('File name');
    expect(fmt.sharedStringsXml).toContain('Escape / outcome');

    const resultsRows = readResultsDisplayRows(buffer);
    expect(Object.keys(resultsRows[0] ?? {})).toEqual(resultsDisplayHeaders());
  });

  it('freezes Events below the note row and applies filter from the header row', async () => {
    const data = loadThreeTrialExport();
    const buffer = await buildSessionXlsxArrayBuffer(data);
    const fmt = inspectSavedXlsx(buffer);

    expect(fmt.sharedStringsXml).toContain('startFrameDisplay');
    expect(fmt.sharedStringsXml).toContain(FRAME_INDEX_NOTE_FRAGMENT);
    expect(hasFrozenPane(fmt.eventsXml)).toBe(true);
    expect(fmt.eventsXml).toMatch(/<autoFilter ref="A2:X\d+"/);
    expect(hasStyledHeaderCells(fmt.eventsXml)).toBe(true);

    const events = readEventsSheetRows(buffer);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.startFrameDisplay).toBe(Number(events[0]?.startFrameIndex) + 1);
  });

  it('preserves machine-readable Summary columns and scientific values on disk', async () => {
    const data = loadThreeTrialExport();
    const buffer = await buildSessionXlsxArrayBuffer(data);
    const summary = readXlsxSheetRows(buffer, 'Summary');
    const row = summary.find((r) => String(r.fileName ?? '').includes('test53'));
    expect(row?.totalLatency_value).toBe(24.4);
    expect(row?.totalLatency_valueKind).toBe('numeric');
    expect(row?.primaryErrorsConfirmed == null || row?.primaryErrorsConfirmed === '').toBe(true);
    expect(Number(row?.maxSpeed_value)).toBeCloseTo(115.13, 1);
  });
});

const FRAME_INDEX_NOTE_FRAGMENT =
  'startFrameIndex and endFrameIndex are 0-based internal decoder indices';

describe('MS-6 XLSX formatting on regenerated export', () => {
  it('matches formatting expectations after buildSessionXlsxArrayBuffer', async () => {
    const buffer = await buildSessionXlsxArrayBuffer(loadThreeTrialExport());
    const fmt = inspectSavedXlsx(buffer);

    expect(hasFrozenPane(fmt.resultsXml)).toBe(true);
    expect(hasFrozenPane(fmt.summaryXml)).toBe(true);
    expect(hasFrozenPane(fmt.eventsXml)).toBe(true);
    expect(hasWrapTextStyles(fmt.stylesXml)).toBe(true);
    expect(hasWrappedDataCells(fmt.resultsXml)).toBe(true);
    expect(fmt.sharedStringsXml).toContain('Escape / outcome');
  });
});
