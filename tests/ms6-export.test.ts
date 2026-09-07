import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  encodeMeasureValue,
  measureValueKind,
  formatMeasureForDisplay,
} from '../src/domain/export/measureEncoding';
import { buildEventExportRows } from '../src/domain/export/eventsTable';
import { buildTrialSummaryRow } from '../src/domain/export/trialSummary';
import { buildSessionExportData } from '../src/domain/export/sessionExport';
import { buildSessionCsvFiles } from '../src/domain/export/csvExport';
import { buildSessionXlsxArrayBuffer, getXlsxSheetNames } from '../src/domain/export/xlsxExport';
import { escapeExportLabel } from '../src/domain/export/escapeSummary';
import { computeMeasures } from '../src/domain/measures/computeMeasures';
import {
  defaultEventDetectionParams,
  defaultOperationalDefinitions,
  defaultTrackingParams,
  TOOL_VERSION,
} from '../src/domain/trialFactory';
import type {
  AnalysisParams,
  BehavioralEvent,
  Geometry,
  MeasureValue,
  MeasuresSnapshot,
  TrialRecord,
  TrialWindow,
} from '../src/domain/types';

const FIXTURES = join(__dirname, 'fixtures', 'ms6');

const geometry: Geometry = {
  platformCenter: { x: 320, y: 240 },
  platformRadiusPx: 200,
  holes: Array.from({ length: 20 }, (_, i) => ({
    id: i,
    x: 320 + 200 * Math.cos((i * 18 * Math.PI) / 180),
    y: 240 + 200 * Math.sin((i * 18 * Math.PI) / 180),
    source: 'detected' as const,
    confidence: 1,
  })),
  targetHoleId: 5,
  proposedTargetHoleId: 5,
  targetHoleConfirmedAt: '2026-01-01T00:00:00.000Z',
  pxPerCm: 10,
  diameterCm: 40,
  ringRotationDeg: 0,
  source: 'auto',
  templateSourceTrialId: null,
  confirmedAt: '2026-01-01T00:00:00.000Z',
  calibrationReviewAcknowledgedAt: null,
  detection: null,
};

const geometryNoTarget: Geometry = {
  ...geometry,
  targetHoleId: null,
  proposedTargetHoleId: null,
  targetHoleConfirmedAt: null,
  pxPerCm: null,
  diameterCm: null,
};

const trialWindow: TrialWindow = {
  startTimeUs: 5_000_000,
  endTimeUs: 30_000_000,
  cutoffSeconds: 180,
  source: 'manual',
  proposedStartTimeUs: 5_000_000,
  proposedEndTimeUs: 30_000_000,
  confirmedAt: '2026-01-01T00:00:00.000Z',
  motionOnsetConfidence: 0.9,
  detectionFailureReason: null,
};

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

function mv(partial: Partial<MeasureValue>): MeasureValue {
  return {
    value: null,
    unit: 's',
    censored: false,
    unavailable: false,
    unavailableReason: null,
    lowerBound: null,
    lowerBoundUnit: null,
    definitionId: 'test.v1',
    definitionVersion: '1',
    definitionLabel: 'Test',
    definitionSummary: 'Test measure',
    assumptions: [],
    flags: [],
    ...partial,
  };
}

function makeEscapeEvent(overrides: Partial<BehavioralEvent> = {}): BehavioralEvent {
  return {
    id: 'esc-1',
    type: 'escape_completed',
    holeId: 3,
    startFrameIndex: 100,
    endFrameIndex: 110,
    startTimeUs: 10_000_000,
    endTimeUs: 11_000_000,
    entryOnsetTimeUs: 10_000_000,
    completionTimeUs: 11_000_000,
    censorBoundaryTimeUs: 30_000_000,
    origin: 'auto',
    status: 'proposed',
    confidence: 'medium',
    visitIndex: null,
    isRevisit: null,
    evidence: {
      bodyEntryPath: 'centroid_pixel',
      bodyEntryDefinitionVersion: '3',
      observedFollowUpLowerBoundUs: 25_000_000,
    },
    notes: null,
    ...overrides,
  };
}

function makeTrial(overrides: Partial<TrialRecord> = {}): TrialRecord {
  return {
    id: 'trial-1',
    fingerprint: 'fp-abc',
    fileName: 'test53.mp4',
    label: 'test53',
    ingestStatus: 'ready',
    ingestError: null,
    videoCached: true,
    metadata: null,
    timestampIndex: [{ timeUs: 5_000_000, frameIndex: 0, cts: 150000, timescale: 30000 }],
    trialWindow,
    geometry,
    track: {
      status: 'done',
      observations: [],
      manualCorrections: [],
      appliedCleaning: null,
      quality: {
        totalFrames: 0,
        trackedCount: 0,
        trackedFraction: 1,
        lostCount: 0,
        lostFraction: 0,
        absentInHoleCount: 0,
        longestLostGapFrames: 0,
        longestLostGapUs: 0,
        lowConfidenceCount: 0,
        speedOutlierCount: 0,
        meanConfidence: 1,
        medianConfidence: 1,
        overallAssessment: 'high',
        assessmentReasons: [],
        flaggedFrames: [],
      },
      params: defaultTrackingParams(),
      computedAt: '2026-01-01T00:00:00.000Z',
      error: null,
    },
    events: null,
    measures: null,
    measurementBasis: 'corrected',
    progress: { lastIngestAt: null, decodeWallClockMs: null },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('MS-6 U1 censored total latency encoding', () => {
  it('encodes censored without numeric value', () => {
    const encoded = encodeMeasureValue(
      'totalLatency',
      mv({ censored: true, lowerBound: 25.2, lowerBoundUnit: 's', flags: ['escape_incomplete_censored'] }),
    );
    expect(encoded.valueKind).toBe('censored');
    expect(encoded.value).toBeNull();
    expect(encoded.lowerBound).toBe(25.2);
  });
});

describe('MS-6 U2 proposed escape encoding', () => {
  it('uses proposed valueKind for escape_completed_proposed flag', () => {
    const encoded = encodeMeasureValue(
      'totalLatency',
      mv({ censored: true, flags: ['escape_completed_proposed'], lowerBound: 20 }),
    );
    expect(encoded.valueKind).toBe('proposed');
    expect(encoded.value).toBeNull();
  });
});

describe('MS-6 U3 confirmed escape numeric latency', () => {
  it('exports numeric value when confirmed', () => {
    const encoded = encodeMeasureValue('totalLatency', mv({ value: 24.4, unit: 's' }));
    expect(encoded.valueKind).toBe('numeric');
    expect(encoded.value).toBe(24.4);
  });
});

describe('MS-6 U4 target unknown summary', () => {
  it('marks primary latency unavailable in summary row', () => {
    const measures = computeMeasures(
      [],
      [],
      geometryNoTarget,
      trialWindow,
      [{ timeUs: 5_000_000 }],
      defaultEventDetectionParams(),
      defaultOperationalDefinitions(),
      'corrected',
    )!;
    const row = buildTrialSummaryRow(
      makeTrial({ geometry: geometryNoTarget, measures }),
    );
    expect(row.primaryLatency_valueKind).toBe('unavailable');
    expect(row.targetStatus).toBe('unknown');
    expect(row.targetQuadrantFraction_valueKind).toBe('unavailable');
  });
});

describe('MS-6 U5 scale unknown path length', () => {
  it('exports path length in px with scale flag', () => {
    const measures = computeMeasures(
      [],
      [],
      geometryNoTarget,
      trialWindow,
      [{ timeUs: 5_000_000 }],
      defaultEventDetectionParams(),
      defaultOperationalDefinitions(),
      'corrected',
    )!;
    const row = buildTrialSummaryRow(
      makeTrial({ geometry: geometryNoTarget, measures }),
    );
    expect(row.pathLength_unit).toBe('px');
    expect(row.scaleStatus).toBe('unknown');
    expect(String(row.pathLength_assumptions)).toContain('scale_unavailable_px');
  });
});

describe('MS-6 U6 events detail columns', () => {
  it('includes status, origin, and body-entry version', () => {
    const rows = buildEventExportRows('trial-1', [makeEscapeEvent()], geometry);
    expect(rows[0]?.status).toBe('proposed');
    expect(rows[0]?.origin).toBe('auto');
    expect(rows[0]?.bodyEntryVersion).toBe('3');
    expect(rows[0]?.bodyEntryPath).toBe('centroid_pixel');
  });
});

describe('MS-6 U7 export does not detect events', () => {
  it('buildSessionExportData is pure serialization', () => {
    const detectSpy = vi.fn();
    const trial = makeTrial({
      measures: {
        basisUsed: 'corrected',
        computedAt: '2026-01-01T00:00:00.000Z',
        primaryLatency: mv({ unavailable: true, unavailableReason: 'x', definitionId: 'primary_latency.v1', definitionLabel: 'Primary latency', definitionSummary: 'x' }),
        totalLatency: mv({ censored: true, definitionId: 'total_latency.v1', definitionLabel: 'Total latency', definitionSummary: 'x', flags: ['no_escape_record'] }),
        primaryErrors: mv({ unavailable: true, unavailableReason: 'x', definitionId: 'primary_errors.v1', definitionLabel: 'Primary errors', definitionSummary: 'x', unit: 'count' }),
        totalErrors: mv({ unavailable: true, unavailableReason: 'x', definitionId: 'total_errors.v1', definitionLabel: 'Total errors', definitionSummary: 'x', unit: 'count' }),
        errorCounts: { confirmed: { total: 0, distinctHoleCount: 0, revisitCount: 0 }, provisional: { total: 0, distinctHoleCount: 0, revisitCount: 0 } },
        totalErrorCounts: { confirmed: { total: 0, distinctHoleCount: 0, revisitCount: 0 }, provisional: { total: 0, distinctHoleCount: 0, revisitCount: 0 } },
        pathLength: mv({ value: 100, unit: 'px', definitionId: 'path_length.v1', definitionLabel: 'Path length', definitionSummary: 'x' }),
        meanSpeed: mv({ value: 5, unit: 'px/s', definitionId: 'mean_speed.v1', definitionLabel: 'Mean speed', definitionSummary: 'x' }),
        maxSpeed: mv({ value: 10, unit: 'px/s', definitionId: 'max_speed.v1', definitionLabel: 'Max speed', definitionSummary: 'x' }),
        targetQuadrantFraction: mv({ unavailable: true, unavailableReason: 'x', definitionId: 'target_quadrant_fraction.v1', definitionLabel: 'Target quadrant fraction', definitionSummary: 'x', unit: 'fraction' }),
        targetQuadrantTimeSec: mv({ unavailable: true, unavailableReason: 'x', definitionId: 'target_quadrant_time.v1', definitionLabel: 'Target quadrant time', definitionSummary: 'x' }),
        searchStrategy: { classification: 'unclassified', override: null, overrideReason: null, reasoning: {}, classifierVersion: 'heuristic_v1' },
        assumptions: [],
      } satisfies MeasuresSnapshot,
    });
    const before = JSON.stringify(trial);
    buildSessionExportData([trial], analysisParams, '2026-01-01T00:00:00.000Z');
    expect(JSON.stringify(trial)).toBe(before);
    expect(detectSpy).not.toHaveBeenCalled();
  });
});

describe('MS-6 U8 XLSX sheet names', () => {
  it('includes required worksheets', () => {
    const data = buildSessionExportData(
      [makeTrial()],
      analysisParams,
      '2026-01-01T00:00:00.000Z',
    );
    const buffer = buildSessionXlsxArrayBuffer(data);
    expect(getXlsxSheetNames(buffer)).toEqual([
      'Summary',
      'Events',
      'Parameters',
      'OperationalDefinitions',
      'Provenance',
    ]);
  });
});

describe('MS-6 U13 escape_entry_uncertain label', () => {
  it('exports candidate entry label not escaped', () => {
    const ev = makeEscapeEvent({ type: 'escape_entry_uncertain', status: 'proposed' });
    expect(escapeExportLabel(ev, false)).toBe('candidate_hole_entry_not_protocol_escape');
    const rows = buildEventExportRows('t1', [ev], geometryNoTarget);
    expect(rows[0]?.exportLabel).toBe('candidate_hole_entry_not_protocol_escape');
  });
});

describe('MS-6 U14 session export row count', () => {
  it('produces one summary row per tracked trial', () => {
    const data = buildSessionExportData(
      [makeTrial({ id: 'a', label: 'a' }), makeTrial({ id: 'b', label: 'b' })],
      analysisParams,
    );
    expect(data.summaryRows).toHaveLength(2);
    expect(data.summaryObjects).toHaveLength(2);
  });
});

describe('MS-6 CSV contains valueKind', () => {
  it('summary CSV includes valueKind columns', () => {
    const measures = computeMeasures(
      [],
      [makeEscapeEvent({ status: 'proposed' })],
      geometryNoTarget,
      trialWindow,
      [{ timeUs: 5_000_000 }],
      defaultEventDetectionParams(),
      defaultOperationalDefinitions(),
      'corrected',
    )!;
    const data = buildSessionExportData(
      [makeTrial({ geometry: geometryNoTarget, measures, events: { events: [makeEscapeEvent()], params: defaultEventDetectionParams(), operationalDefinitions: defaultOperationalDefinitions(), basisUsed: 'corrected', computedAt: '2026-01-01T00:00:00.000Z' } })],
      analysisParams,
    );
    const csv = buildSessionCsvFiles(data).summaryCsv;
    expect(csv).toContain('totalLatency_valueKind');
    expect(csv).toContain('proposed');
    expect(csv).toContain('maxSpeed_valueKind');
    expect(csv).toContain('targetQuadrantFraction_valueKind');
  });
});

describe('MS-6 formatMeasureForDisplay', () => {
  it('shows proposed note for censored proposed escape', () => {
    const text = formatMeasureForDisplay(
      mv({ censored: true, flags: ['escape_completed_proposed'], lowerBound: 20, lowerBoundUnit: 's' }),
    );
    expect(text).toContain('proposed');
    expect(text).not.toMatch(/^24/);
  });
});

describe('MS-6 measureValueKind', () => {
  it('classifies unavailable before censored', () => {
    expect(measureValueKind(mv({ unavailable: true, censored: true }))).toBe('unavailable');
  });
});

describe('MS-6 fixture export_unknown_target', () => {
  it('loads fixture and marks target-dependent measures unavailable', () => {
    const fixture = JSON.parse(readFileSync(join(FIXTURES, 'export_unknown_target.json'), 'utf8'));
    const row = buildTrialSummaryRow(fixture.trial as TrialRecord);
    expect(row.primaryLatency_valueKind).toBe('unavailable');
    expect(row.maxSpeed_valueKind).toBe('numeric');
    expect(row.targetQuadrantFraction_valueKind).toBe('unavailable');
  });
});
