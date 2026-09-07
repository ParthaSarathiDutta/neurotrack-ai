import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildNeuroTrackBundle, serializeNeuroTrackBundle } from '../src/domain/export/bundleExport';
import {
  applyBundleImport,
  detectImportCollisions,
  previewBundleImport,
} from '../src/domain/export/bundleImport';
import { parseNeuroTrackBundleJson, validateNeuroTrackBundle } from '../src/domain/export/bundleSchema';
import {
  defaultEventDetectionParams,
  defaultOperationalDefinitions,
  defaultTrackingParams,
  TOOL_VERSION,
} from '../src/domain/trialFactory';
import { defaultAnalysisParams } from '../src/db/database';
import type {
  AnalysisParams,
  AppliedCleaning,
  BehavioralEvent,
  ManualCorrection,
  Observation,
  TrialRecord,
} from '../src/domain/types';

const FIXTURES = join(__dirname, 'fixtures', 'ms6');

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

function obs(frameIndex: number, timeUs: number): Observation {
  return {
    frameIndex,
    timeUs,
    bodyXY: { x: 320 + frameIndex, y: 240 },
    noseXY: { x: 320 + frameIndex, y: 235 },
    confidence: 0.9,
    observed: 'tracked',
    origin: 'auto',
    qualityFlags: null,
  };
}

function makeRoundTripTrial(): TrialRecord {
  const manualCorrections: ManualCorrection[] = [
    {
      frameIndex: 10,
      timeUs: 5_333_333,
      bodyXY: { x: 400, y: 250 },
      noseXY: null,
      correctedAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  const appliedCleaning: AppliedCleaning = {
    params: analysisParams.cleaning,
    observations: [obs(11, 5_600_000)],
    appliedAt: '2026-01-01T00:00:00.000Z',
    stale: false,
    staleReason: null,
  };
  const escapeEvent: BehavioralEvent = {
    id: 'esc-confirmed',
    type: 'escape_completed',
    holeId: 3,
    startFrameIndex: 880,
    endFrameIndex: 880,
    startTimeUs: 29_400_000,
    endTimeUs: 29_400_000,
    entryOnsetTimeUs: 29_200_000,
    completionTimeUs: 29_400_000,
    censorBoundaryTimeUs: 30_230_000,
    origin: 'auto',
    status: 'confirmed',
    confidence: 'high',
    visitIndex: null,
    isRevisit: null,
    evidence: {
      bodyEntryPath: 'centroid_pixel',
      bodyEntryDefinitionVersion: '3',
      bodyEntryCompletionEstablished: true,
    },
    notes: null,
  };

  return {
    id: 'trial-roundtrip',
    fingerprint: 'fp-roundtrip-abc',
    fileName: 'test53.mp4',
    label: 'test53',
    ingestStatus: 'ready',
    ingestError: null,
    videoCached: true,
    metadata: {
      codec: 'avc1',
      codedWidth: 640,
      codedHeight: 480,
      trackTimescale: 30000,
      durationSec: 30.23,
      nbSamples: 905,
      decoderOutputFrames: 905,
      containerFrameRateLabel: '30/1',
      medianUniqueCtsDelta: 3000,
      frameCountWarning: null,
    },
    timestampIndex: [{ timeUs: 5_000_000, frameIndex: 0, cts: 150000, timescale: 30000 }],
    trialWindow: {
      startTimeUs: 5_000_000,
      endTimeUs: 30_230_000,
      cutoffSeconds: null,
      source: 'manual',
      proposedStartTimeUs: 5_000_000,
      proposedEndTimeUs: 30_230_000,
      confirmedAt: '2026-01-01T00:00:00.000Z',
      motionOnsetConfidence: 0.9,
      detectionFailureReason: null,
    },
    geometry: {
      platformCenter: { x: 329, y: 242 },
      platformRadiusPx: 204,
      holes: [],
      targetHoleId: null,
      proposedTargetHoleId: null,
      targetHoleConfirmedAt: null,
      pxPerCm: null,
      diameterCm: null,
      ringRotationDeg: 0,
      source: 'auto',
      templateSourceTrialId: null,
      confirmedAt: '2026-01-01T00:00:00.000Z',
      calibrationReviewAcknowledgedAt: null,
      detection: null,
    },
    track: {
      status: 'done',
      observations: [obs(0, 5_000_000), obs(1, 5_033_333)],
      manualCorrections,
      appliedCleaning,
      quality: {
        totalFrames: 2,
        trackedCount: 2,
        trackedFraction: 1,
        lostCount: 0,
        lostFraction: 0,
        absentInHoleCount: 0,
        longestLostGapFrames: 0,
        longestLostGapUs: 0,
        lowConfidenceCount: 0,
        speedOutlierCount: 0,
        meanConfidence: 0.9,
        medianConfidence: 0.9,
        overallAssessment: 'high',
        assessmentReasons: [],
        flaggedFrames: [],
      },
      params: defaultTrackingParams(),
      computedAt: '2026-01-01T00:00:00.000Z',
      error: null,
    },
    events: {
      events: [escapeEvent],
      params: defaultEventDetectionParams(),
      operationalDefinitions: defaultOperationalDefinitions(),
      basisUsed: 'corrected',
      computedAt: '2026-01-01T00:00:00.000Z',
    },
    measures: {
      basisUsed: 'corrected',
      computedAt: '2026-01-01T00:00:00.000Z',
      primaryLatency: {
        value: null,
        unit: 's',
        censored: false,
        unavailable: true,
        unavailableReason: 'Target hole not confirmed.',
        definitionId: 'primary_latency.v1',
        definitionVersion: '1',
        definitionLabel: 'Primary latency',
        definitionSummary: 'x',
        assumptions: [],
        flags: [],
      },
      totalLatency: {
        value: 24.4,
        unit: 's',
        censored: false,
        unavailable: false,
        definitionId: 'total_latency.v1',
        definitionVersion: '1',
        definitionLabel: 'Total latency',
        definitionSummary: 'confirmed',
        assumptions: [],
        flags: [],
      },
      primaryErrors: {
        value: null,
        unit: 'count',
        censored: false,
        unavailable: true,
        unavailableReason: 'Target hole not confirmed.',
        definitionId: 'primary_errors.v1',
        definitionVersion: '1',
        definitionLabel: 'Primary errors',
        definitionSummary: 'x',
        assumptions: [],
        flags: [],
      },
      totalErrors: {
        value: null,
        unit: 'count',
        censored: false,
        unavailable: true,
        unavailableReason: 'Target hole not confirmed.',
        definitionId: 'total_errors.v1',
        definitionVersion: '1',
        definitionLabel: 'Total errors',
        definitionSummary: 'x',
        assumptions: [],
        flags: [],
      },
      errorCounts: {
        confirmed: { total: 0, distinctHoleCount: 0, revisitCount: 0 },
        provisional: { total: 0, distinctHoleCount: 0, revisitCount: 0 },
      },
      totalErrorCounts: {
        confirmed: { total: 0, distinctHoleCount: 0, revisitCount: 0 },
        provisional: { total: 0, distinctHoleCount: 0, revisitCount: 0 },
      },
      pathLength: {
        value: 100,
        unit: 'px',
        censored: false,
        unavailable: false,
        definitionId: 'path_length.v1',
        definitionVersion: '1',
        definitionLabel: 'Path length',
        definitionSummary: 'x',
        assumptions: ['scale_unavailable_px'],
        flags: [],
      },
      meanSpeed: {
        value: 5,
        unit: 'px/s',
        censored: false,
        unavailable: false,
        definitionId: 'mean_speed.v1',
        definitionVersion: '1',
        definitionLabel: 'Mean speed',
        definitionSummary: 'x',
        assumptions: [],
        flags: [],
      },
      maxSpeed: {
        value: 10,
        unit: 'px/s',
        censored: false,
        unavailable: false,
        definitionId: 'max_speed.v1',
        definitionVersion: '1',
        definitionLabel: 'Max speed',
        definitionSummary: 'x',
        assumptions: [],
        flags: [],
      },
      targetQuadrantFraction: {
        value: null,
        unit: 'fraction',
        censored: false,
        unavailable: true,
        unavailableReason: 'Target hole not confirmed.',
        definitionId: 'target_quadrant_fraction.v1',
        definitionVersion: '1',
        definitionLabel: 'Target quadrant fraction',
        definitionSummary: 'x',
        assumptions: [],
        flags: [],
      },
      targetQuadrantTimeSec: {
        value: null,
        unit: 's',
        censored: false,
        unavailable: true,
        unavailableReason: 'Target hole not confirmed.',
        definitionId: 'target_quadrant_time.v1',
        definitionVersion: '1',
        definitionLabel: 'Target quadrant time',
        definitionSummary: 'x',
        assumptions: [],
        flags: [],
      },
      searchStrategy: {
        classification: 'spatial',
        override: 'random',
        overrideReason: 'Reviewer adjustment',
        reasoning: { classifierVersion: 'heuristic_v1' },
        classifierVersion: 'heuristic_v1',
      },
      assumptions: [],
    },
    measurementBasis: 'corrected',
    progress: { lastIngestAt: null, decodeWallClockMs: null },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('MS-6 U9 bundle schema validation', () => {
  it('rejects unsupported schemaVersion', () => {
    const result = validateNeuroTrackBundle({
      schemaVersion: '9.0.0',
      bundleType: 'neurotrack-analysis',
      exportedAt: '2026-01-01T00:00:00.000Z',
      toolVersion: TOOL_VERSION,
      analysisParams: defaultAnalysisParams(),
      selectedTrialId: null,
      trials: [],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects empty trials array', () => {
    const result = validateNeuroTrackBundle({
      schemaVersion: '1.0.0',
      bundleType: 'neurotrack-analysis',
      exportedAt: '2026-01-01T00:00:00.000Z',
      toolVersion: TOOL_VERSION,
      analysisParams: defaultAnalysisParams(),
      selectedTrialId: null,
      trials: [],
    });
    expect(result.ok).toBe(false);
  });
});

describe('MS-6 U10 bundle round-trip preservation', () => {
  it('preserves observations, corrections, events, measures, and strategy override', () => {
    const trial = makeRoundTripTrial();
    const bundle = buildNeuroTrackBundle([trial], analysisParams, trial.id, '2026-01-01T00:00:00.000Z');
    const json = serializeNeuroTrackBundle(bundle);
    const parsed = parseNeuroTrackBundleJson(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const applied = applyBundleImport({
      bundle: parsed.bundle,
      existingTrials: [],
      existingSelectedTrialId: null,
      existingAnalysisParams: analysisParams,
      replaceConfirmed: false,
      cachedFingerprints: new Set(),
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const imported = applied.trials.find((t) => t.id === trial.id)!;
    expect(imported.track?.observations).toEqual(trial.track!.observations);
    expect(imported.track?.manualCorrections).toEqual(trial.track!.manualCorrections);
    expect(imported.track?.appliedCleaning?.observations).toEqual(
      trial.track!.appliedCleaning!.observations,
    );
    expect(imported.events?.events[0]?.status).toBe('confirmed');
    expect(imported.events?.events[0]?.completionTimeUs).toBe(29_400_000);
    expect(imported.measures?.totalLatency.value).toBe(24.4);
    expect(imported.measures?.searchStrategy.override).toBe('random');
    expect(imported.videoCached).toBe(false);
    expect(imported.ingestStatus).toBe('needs_reselect');
    expect(applied.trialsNeedingVideoReselect).toContain(trial.id);
  });
});

describe('MS-6 U11 import collision confirmation', () => {
  it('requires replaceConfirmed when trial id collides', () => {
    const trial = makeRoundTripTrial();
    const bundle = buildNeuroTrackBundle([trial], analysisParams, trial.id);
    const existing = { ...trial, label: 'old-label', measures: null };

    const collisions = detectImportCollisions(bundle, [existing]);
    expect(collisions.length).toBeGreaterThan(0);

    const blocked = applyBundleImport({
      bundle,
      existingTrials: [existing],
      existingSelectedTrialId: existing.id,
      existingAnalysisParams: analysisParams,
      replaceConfirmed: false,
      cachedFingerprints: new Set(),
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.reason).toBe('collision');

    const allowed = applyBundleImport({
      bundle,
      existingTrials: [existing],
      existingSelectedTrialId: existing.id,
      existingAnalysisParams: analysisParams,
      replaceConfirmed: true,
      cachedFingerprints: new Set(),
    });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    expect(allowed.trials.find((t) => t.id === trial.id)?.measures?.totalLatency.value).toBe(24.4);
  });
});

describe('MS-6 U12 fingerprint relink without cache', () => {
  it('marks needs_reselect when fingerprint not cached', () => {
    const trial = makeRoundTripTrial();
    const bundle = buildNeuroTrackBundle([trial], analysisParams, trial.id);
    const applied = applyBundleImport({
      bundle,
      existingTrials: [],
      existingSelectedTrialId: null,
      existingAnalysisParams: analysisParams,
      replaceConfirmed: false,
      cachedFingerprints: new Set(),
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.trials[0]?.ingestStatus).toBe('needs_reselect');
  });

  it('sets videoCached when fingerprint is cached', () => {
    const trial = makeRoundTripTrial();
    const bundle = buildNeuroTrackBundle([trial], analysisParams, trial.id);
    const applied = applyBundleImport({
      bundle,
      existingTrials: [],
      existingSelectedTrialId: null,
      existingAnalysisParams: analysisParams,
      replaceConfirmed: false,
      cachedFingerprints: new Set([trial.fingerprint]),
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.trials[0]?.videoCached).toBe(true);
    expect(applied.trials[0]?.ingestStatus).toBe('ready');
  });
});

describe('MS-6 bundle export is read-only', () => {
  it('does not mutate source trial on export', () => {
    const trial = makeRoundTripTrial();
    const before = JSON.stringify(trial);
    buildNeuroTrackBundle([trial], analysisParams, trial.id);
    expect(JSON.stringify(trial)).toBe(before);
  });
});

describe('MS-6 import_invalid_schema fixture', () => {
  it('rejects corrupt bundle fixture', () => {
    const raw = JSON.parse(readFileSync(join(FIXTURES, 'import_invalid_schema.json'), 'utf8'));
    const result = validateNeuroTrackBundle(raw);
    expect(result.ok).toBe(false);
  });
});

describe('MS-6 previewBundleImport', () => {
  it('returns collisions without applying', () => {
    const trial = makeRoundTripTrial();
    const bundle = buildNeuroTrackBundle([trial], analysisParams, trial.id);
    const json = serializeNeuroTrackBundle(bundle);
    const preview = previewBundleImport(JSON.parse(json), [trial], new Set());
    expect('collisions' in preview && preview.collisions.length).toBeGreaterThan(0);
  });
});
