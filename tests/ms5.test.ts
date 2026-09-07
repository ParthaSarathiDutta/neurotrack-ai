import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isInvestigationConfirmed,
  isInvestigationProvisional,
  mergeDetectedEvents,
} from '../src/domain/events/eventMerge';
import { mergeManualEventEdit, reindexInvestigationVisits } from '../src/domain/events/manualEvents';
import { computePathSpeedMetrics } from '../src/domain/measures/pathMetrics';
import { computeErrorCounts, computeTotalErrorCounts } from '../src/domain/measures/errorCounts';
import { detectEvents } from '../src/domain/events/detectEvents';
import { detectEscapeOutcome } from '../src/domain/events/escape';
import { computeMeasures } from '../src/domain/measures/computeMeasures';
import { selectPixelEvidenceFrameIndices } from '../src/domain/events/pixelEvidence';
import { detectInvestigations } from '../src/domain/events/investigations';
import { classifySearchStrategy } from '../src/domain/measures/searchStrategy';
import { resolveMeasurementObservations } from '../src/domain/trajectory/measurementObservations';
import { defaultCleaningParams, defaultEventDetectionParams, defaultOperationalDefinitions, defaultTrackingParams } from '../src/domain/trialFactory';
import type {
  BehavioralEvent,
  Geometry,
  Observation,
  Track,
  TrialWindow,
} from '../src/domain/types';

const FIXTURES = join(__dirname, 'fixtures', 'ms5');

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

function obs(
  frameIndex: number,
  timeUs: number,
  x: number,
  y: number,
  nose?: { x: number; y: number } | null,
  extra: Partial<Observation> = {},
): Observation {
  return {
    frameIndex,
    timeUs,
    bodyXY: { x, y },
    noseXY: nose ?? null,
    confidence: 0.8,
    observed: 'tracked',
    origin: 'auto',
    qualityFlags: null,
    ...extra,
  };
}

function loadFixture(name: string) {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
}

describe('MS-5 U1 dwell uses timeUs', () => {
  it('uses ΔtimeUs for dwell not frame count', () => {
    const h0 = geometry.holes[0]!;
    const params = { ...defaultEventDetectionParams(), investigationMinDwellUs: 500_000 };
    const observations = [
      obs(0, 5_000_000, h0.x, h0.y, { x: h0.x, y: h0.y - 3 }),
      obs(1, 5_600_000, h0.x, h0.y, { x: h0.x, y: h0.y - 3 }),
    ];
    const ts = observations.map((o) => ({ timeUs: o.timeUs, frameIndex: o.frameIndex }));
    const events = detectInvestigations(observations, geometry, trialWindow, ts, params);
    expect(events).toHaveLength(1);
    expect(events[0]?.evidence.dwellUs).toBe(600_000);
  });
});

describe('MS-5 U2 body-only confidence', () => {
  it('body-only proximity yields low or medium confidence, never synthetic nose', () => {
    const h0 = geometry.holes[0]!;
    const params = defaultEventDetectionParams();
    const observations = [
      obs(0, 5_000_000, h0.x, h0.y, null),
      obs(1, 5_500_000, h0.x, h0.y, null),
      obs(2, 6_000_000, h0.x, h0.y, null),
    ];
    const ts = observations.map((o) => ({ timeUs: o.timeUs, frameIndex: o.frameIndex }));
    const events = detectInvestigations(observations, geometry, trialWindow, ts, params);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.confidence === 'low' || e.confidence === 'medium').toBe(true);
      expect(e.evidence.proximityBasis).toBe('body');
    }
  });
});

describe('MS-5 U3 visitIndex / isRevisit', () => {
  it('assigns visitIndex and isRevisit on repeat hole visits', () => {
    const h0 = geometry.holes[0]!;
    const params = defaultEventDetectionParams();
    const observations: Observation[] = [];
    for (const [start, end] of [
      [5_000_000, 5_500_000],
      [8_000_000, 8_500_000],
    ] as const) {
      observations.push(obs(observations.length, start, h0.x, h0.y, { x: h0.x, y: h0.y - 3 }));
      observations.push(obs(observations.length, end, h0.x, h0.y, { x: h0.x, y: h0.y - 3 }));
      observations.push(obs(observations.length, end + 500_000, 320, 240));
    }
    const ts = observations.map((o) => ({ timeUs: o.timeUs, frameIndex: o.frameIndex }));
    const events = detectInvestigations(observations, geometry, trialWindow, ts, params);
    const hole0 = events.filter((e) => e.holeId === 0);
    expect(hole0.some((e) => e.visitIndex === 1 && e.isRevisit === false)).toBe(true);
    expect(hole0.some((e) => e.visitIndex === 2 && e.isRevisit === true)).toBe(true);
  });
});

describe('MS-5 U4 provisional error counts', () => {
  it('excludes proposed low-confidence from confirmed totals', () => {
    const fixture = loadFixture('provisional_errors.json');
    const counts = computeTotalErrorCounts(fixture.events, geometry, 30_000_000);
    expect(counts.provisional.total).toBe(2);
    expect(counts.confirmed.total).toBe(0);
  });
});

describe('MS-5 U5 confirmed vs rejected', () => {
  it('confirmed low-confidence counts as confirmed; rejected never counts', () => {
    const ev: BehavioralEvent = {
      id: '1',
      type: 'investigation',
      holeId: 1,
      startFrameIndex: 10,
      endFrameIndex: 12,
      startTimeUs: 6_000_000,
      endTimeUs: 6_400_000,
      entryOnsetTimeUs: null,
      completionTimeUs: null,
      censorBoundaryTimeUs: null,
      origin: 'auto',
      status: 'confirmed',
      confidence: 'low',
      visitIndex: 1,
      isRevisit: false,
      evidence: {},
      notes: null,
    };
    expect(isInvestigationConfirmed(ev)).toBe(true);
    expect(isInvestigationProvisional(ev)).toBe(false);

    const rejected = { ...ev, id: '2', status: 'rejected' as const };
    const counts = computeErrorCounts([rejected], geometry, 5_000_000, 30_000_000);
    expect(counts.confirmed.total).toBe(0);
  });

  it('manual confirmed investigation included in confirmed counts', () => {
    const manual: BehavioralEvent = {
      id: 'm',
      type: 'investigation',
      holeId: 1,
      startFrameIndex: 1,
      endFrameIndex: 2,
      startTimeUs: 5_500_000,
      endTimeUs: 5_900_000,
      entryOnsetTimeUs: null,
      completionTimeUs: null,
      censorBoundaryTimeUs: null,
      origin: 'manual',
      status: 'confirmed',
      confidence: 'medium',
      visitIndex: 1,
      isRevisit: false,
      evidence: { manual: true },
      notes: null,
    };
    expect(isInvestigationConfirmed(manual)).toBe(true);
  });
});

describe('MS-5 U6 mid-platform lost', () => {
  it('yields no escape record', () => {
    const hole = geometry.holes[0]!;
    const observations: Observation[] = [];
    for (let i = 0; i < 3; i += 1) {
      observations.push(obs(i, 5_000_000 + i * 50_000, hole.x + 5, hole.y + 5));
    }
    for (let i = 3; i < 30; i += 1) {
      observations.push(obs(i, 5_000_000 + i * 50_000, 320, 240));
    }
    const ts = observations.map((o) => ({ timeUs: o.timeUs, frameIndex: o.frameIndex }));
    const esc = detectEscapeOutcome(observations, geometry, trialWindow, ts, defaultEventDetectionParams());
    expect(esc).toBeNull();
  });
});

describe('MS-5 U7 escape_completed total latency', () => {
  it('yields numeric total latency from completion − start', () => {
    const fixture = loadFixture('escape_completed.json');
    const measures = computeMeasures(
      fixture.observations,
      fixture.events,
      geometry,
      trialWindow,
      fixture.timestampIndex,
      defaultEventDetectionParams(),
      defaultOperationalDefinitions(),
      'corrected',
    );
    expect(measures?.totalLatency.censored).toBe(false);
    expect(measures?.totalLatency.value).toBe(10);
  });
});

describe('MS-5 U8 escape_incomplete_censored', () => {
  it('censored total latency with lower bound = censor − start', () => {
    const fixture = loadFixture('escape_incomplete_censored.json');
    const measures = computeMeasures(
      fixture.observations,
      fixture.events,
      geometry,
      trialWindow,
      fixture.timestampIndex,
      defaultEventDetectionParams(),
      defaultOperationalDefinitions(),
      'corrected',
    );
    expect(measures?.totalLatency.censored).toBe(true);
    expect(measures?.totalLatency.value).toBeNull();
    expect(measures?.totalLatency.lowerBound).toBe(9);
  });
});

describe('MS-5 U9 trial_censored_no_entry', () => {
  it('censored with lower bound; entry fields null', () => {
    const fixture = loadFixture('trial_censored_no_entry.json');
    const esc = fixture.events[0];
    expect(esc.entryOnsetTimeUs).toBeNull();
    const measures = computeMeasures(
      fixture.observations,
      fixture.events,
      geometry,
      trialWindow,
      fixture.timestampIndex,
      defaultEventDetectionParams(),
      defaultOperationalDefinitions(),
      'corrected',
    );
    expect(measures?.totalLatency.censored).toBe(true);
    expect(measures?.totalLatency.lowerBound).toBe(10);
  });
});

describe('MS-5 U10 total latency never bare duration', () => {
  it('censored trials never expose uncensored numeric total latency', () => {
    const observations: Observation[] = [];
    for (let i = 0; i < 50; i += 1) {
      observations.push(obs(i, 5_000_000 + i * 100_000, 320, 240));
    }
    const analysis = detectEvents({
      observations,
      geometry,
      trialWindow,
      timestampIndex: observations.map((o) => ({ timeUs: o.timeUs, frameIndex: o.frameIndex })),
      params: defaultEventDetectionParams(),
      operationalDefinitions: defaultOperationalDefinitions(),
      basisUsed: 'corrected',
    });
    const measures = computeMeasures(
      observations,
      analysis.events,
      geometry,
      trialWindow,
      observations.map((o) => ({ timeUs: o.timeUs })),
      defaultEventDetectionParams(),
      defaultOperationalDefinitions(),
      'corrected',
    );
    if (measures?.totalLatency.censored) {
      expect(measures.totalLatency.value).toBeNull();
    }
  });
});

describe('MS-5 U11 duplicate PTS path/speed', () => {
  it('path includes displacement; speed excludes zero-Δt pair', () => {
    const observations = [
      obs(0, 5_000_000, 0, 0),
      obs(1, 5_000_000, 3, 4),
      obs(2, 5_100_000, 13, 4),
    ];
    const m = computePathSpeedMetrics(observations, 5_000_000, 30_000_000);
    expect(m.pathLengthPx).toBe(15);
    expect(m.excludedZeroDtPairs).toBe(1);
    expect(m.validSpeedIntervalCount).toBe(1);
  });
});

describe('MS-5 U12 time-weighted mean speed', () => {
  it('uses valid intervals only', () => {
    const observations = [
      obs(0, 5_000_000, 0, 0),
      obs(1, 5_500_000, 10, 0),
      obs(2, 5_600_000, 20, 0),
    ];
    const m = computePathSpeedMetrics(observations, 5_000_000, 30_000_000);
    expect(m.meanSpeedPxPerSec).toBeGreaterThan(0);
    expect(m.validSpeedIntervalCount).toBe(2);
  });
});

describe('MS-5 U13 path gap segments', () => {
  it('breaks path at lost frames and reports excluded gap time', () => {
    const observations = [
      obs(0, 5_000_000, 0, 0),
      obs(1, 5_100_000, 10, 0),
      obs(2, 5_200_000, 0, 0, null, { observed: 'lost', bodyXY: null }),
      obs(3, 5_300_000, 20, 0),
    ];
    const m = computePathSpeedMetrics(observations, 5_000_000, 30_000_000);
    expect(m.pathLengthExcludedGapUs).toBeGreaterThan(0);
  });
});

describe('MS-5 U14 pixel budget incomplete', () => {
  it('does not force escape_completed when pixel incomplete', () => {
    const hole = geometry.holes[0]!;
    const observations: Observation[] = [];
    for (let i = 0; i < 80; i += 1) {
      observations.push(obs(i, 5_000_000 + i * 100_000, hole.x, hole.y, { x: hole.x, y: hole.y - 5 }));
    }
    const ts = observations.map((o) => ({ timeUs: o.timeUs, frameIndex: o.frameIndex }));
    const esc = detectEscapeOutcome(
      observations,
      geometry,
      trialWindow,
      ts,
      defaultEventDetectionParams(),
      {
        pixelEvidence: {
          framesAnalyzed: 2,
          framesRequested: 300,
          complete: false,
          areaDecayScore: 0.9,
          holeDarkeningScore: 0.8,
        },
      },
    );
    expect(esc?.type).not.toBe('escape_completed');
  });

  it('selects trailing frames when budget exceeded', () => {
    const ts = Array.from({ length: 500 }, (_, i) => ({ frameIndex: i, timeUs: i * 100_000 }));
    const selected = selectPixelEvidenceFrameIndices(ts, 0, 499, 50);
    expect(selected.length).toBe(50);
    expect(selected[0]).toBe(450);
  });
});

describe('MS-5 escape completion time', () => {
  it('requires established body entry, not aggregate decay alone', () => {
    const holeTarget = geometry.holes[0]!;
    const observations: Observation[] = [];
    for (let i = 0; i < 120; i += 1) {
      observations.push(
        obs(i, 5_000_000 + i * 100_000, holeTarget.x, holeTarget.y, { x: holeTarget.x, y: holeTarget.y - 5 }),
      );
    }
    const ts = observations.map((o) => ({ timeUs: o.timeUs, frameIndex: o.frameIndex }));
    const censorUs = 17_000_000;
    const esc = detectEscapeOutcome(
      observations,
      geometry,
      { ...trialWindow, endTimeUs: censorUs, cutoffSeconds: null },
      ts,
      defaultEventDetectionParams(),
      {
        pixelEvidence: {
          framesAnalyzed: 50,
          framesRequested: 50,
          complete: true,
          areaDecayScore: 0.9,
          holeDarkeningScore: 0.8,
          bodyEntry: {
            established: true,
            completionFrameIndex: 90,
            completionTimeUs: 14_000_000,
            temporalSupportFrames: 2,
            definitionId: 'neurotrack_body_entry',
            definitionVersion: '1',
            areaDecayScore: 0.9,
            failureReason: null,
            frameMetrics: [],
          },
        },
      },
    );
    expect(esc?.type).toBe('escape_completed');
    expect(esc?.completionTimeUs).toBe(14_000_000);
    expect(esc?.censorBoundaryTimeUs).toBeLessThanOrEqual(censorUs);
    expect(esc?.completionTimeUs).not.toBe(esc?.censorBoundaryTimeUs);
  });
});

describe('MS-5 U15 measurement basis path length', () => {
  it('corrected path differs from raw when manual correction exists', () => {
    const base = [obs(0, 5_000_000, 0, 0), obs(1, 5_100_000, 10, 0)];
    const track: Track = {
      status: 'done',
      observations: base,
      manualCorrections: [{ frameIndex: 1, timeUs: 5_100_000, bodyXY: { x: 30, y: 0 }, noseXY: null, correctedAt: '' }],
      appliedCleaning: null,
      quality: null,
      params: defaultTrackingParams(),
      computedAt: null,
      error: null,
    };
    const raw = resolveMeasurementObservations(track, 'raw');
    const corrected = resolveMeasurementObservations(track, 'corrected');
    const rawPath = computePathSpeedMetrics(raw.observations, 5_000_000, 30_000_000).pathLengthPx;
    const corrPath = computePathSpeedMetrics(corrected.observations, 5_000_000, 30_000_000).pathLengthPx;
    expect(corrPath).toBeGreaterThan(rawPath);
  });
});

describe('MS-5 U16 stale cleaning unavailable', () => {
  it('cleaned basis unavailable when applied cleaning is stale', () => {
    const track: Track = {
      status: 'done',
      observations: [obs(0, 5_000_000, 0, 0)],
      manualCorrections: [],
      appliedCleaning: {
        observations: [obs(0, 5_000_000, 1, 1)],
        params: defaultCleaningParams(),
        appliedAt: '',
        stale: true,
        staleReason: 'test',
      },
      quality: null,
      params: defaultTrackingParams(),
      computedAt: null,
      error: null,
    };
    const result = resolveMeasurementObservations(track, 'cleaned');
    expect(result.unavailable).toBe(true);
  });
});

describe('MS-5 U17 strategy noncentral flag', () => {
  it('flags noncentral start without forcing random classification', () => {
    const h0 = geometry.holes[0]!;
    const observations: Observation[] = [];
    for (let i = 0; i < 30; i += 1) {
      const t = 5_000_000 + i * 200_000;
      const x = h0.x + i * 2;
      const y = h0.y;
      observations.push(obs(i, t, x, y));
    }
    const events: BehavioralEvent[] = [];
    const result = classifySearchStrategy(
      observations,
      events,
      geometry,
      5_000_000,
      30_000_000,
      defaultEventDetectionParams(),
      defaultOperationalDefinitions(),
    );
    expect(result.reasoning.startDistanceFraction).toBeGreaterThan(0.35);
    expect(result.classification === 'unclassified' || result.classification === 'spatial').toBe(true);
  });
});

describe('MS-5 U18 target unknown', () => {
  it('target-dependent measures unavailable', () => {
    const measures = computeMeasures(
      [obs(0, 5_500_000, 320, 240)],
      [],
      geometryNoTarget,
      trialWindow,
      [{ timeUs: 5_500_000 }],
      defaultEventDetectionParams(),
      defaultOperationalDefinitions(),
      'corrected',
    );
    expect(measures?.primaryLatency.unavailable).toBe(true);
    expect(measures?.primaryErrors.unavailable).toBe(true);
  });
});

describe('MS-5 U19 distinct vs revisit errors', () => {
  it('counts distinct holes and revisits separately', () => {
    const fixture = loadFixture('multi_visit_errors.json');
    const counts = computeTotalErrorCounts(fixture.events, geometry, 30_000_000);
    expect(counts.confirmed.distinctHoleCount).toBe(2);
    expect(counts.confirmed.revisitCount).toBe(1);
    expect(counts.confirmed.total).toBe(3);
  });
});

describe('MS-5 U20 primary latency definition switch', () => {
  it('confirmed-only variant unavailable when only proposed target visit exists', () => {
    const events: BehavioralEvent[] = [
      {
        id: '1',
        type: 'investigation',
        holeId: 5,
        startFrameIndex: 1,
        endFrameIndex: 2,
        startTimeUs: 5_200_000,
        endTimeUs: 5_600_000,
        entryOnsetTimeUs: null,
        completionTimeUs: null,
        censorBoundaryTimeUs: null,
        origin: 'auto',
        status: 'proposed',
        confidence: 'high',
        visitIndex: 1,
        isRevisit: false,
        evidence: {},
        notes: null,
      },
    ];
    const confirmedOnly = computeMeasures(
      [obs(0, 5_000_000, 320, 240)],
      events,
      geometry,
      trialWindow,
      [{ timeUs: 5_000_000 }, { timeUs: 5_200_000 }],
      defaultEventDetectionParams(),
      {
        ...defaultOperationalDefinitions(),
        primaryLatencyVariant: 'first_target_investigation_confirmed_only',
      },
      'corrected',
    );
    expect(confirmedOnly?.primaryLatency.censored).toBe(true);
    expect(confirmedOnly?.primaryLatency.value).toBeNull();

    const proximity = computeMeasures(
      [obs(0, 5_000_000, 320, 240)],
      events,
      geometry,
      trialWindow,
      [{ timeUs: 5_000_000 }, { timeUs: 5_200_000 }],
      defaultEventDetectionParams(),
      {
        ...defaultOperationalDefinitions(),
        primaryLatencyVariant: 'first_target_proximity',
      },
      'corrected',
    );
    expect(proximity?.primaryLatency.value).toBeCloseTo(0.2, 1);
  });
});

describe('MS-5 manual event edits', () => {
  it('mergeManualEventEdit updates times from timestamp index', () => {
    const events: BehavioralEvent[] = [
      {
        id: 'e1',
        type: 'investigation',
        holeId: 1,
        startFrameIndex: 5,
        endFrameIndex: 8,
        startTimeUs: 5_500_000,
        endTimeUs: 5_900_000,
        entryOnsetTimeUs: null,
        completionTimeUs: null,
        censorBoundaryTimeUs: null,
        origin: 'auto',
        status: 'proposed',
        confidence: 'high',
        visitIndex: 1,
        isRevisit: false,
        evidence: {},
        notes: null,
      },
    ];
    const ts = [
      { frameIndex: 5, timeUs: 5_500_000 },
      { frameIndex: 10, timeUs: 6_000_000 },
    ];
    const edited = mergeManualEventEdit(events, 'e1', { startFrameIndex: 10, holeId: 2 }, ts);
    expect(edited[0]?.holeId).toBe(2);
    expect(edited[0]?.startTimeUs).toBe(6_000_000);
    expect(edited[0]?.origin).toBe('manual');
  });

  it('reindexInvestigationVisits updates visitIndex after manual add', () => {
    const events: BehavioralEvent[] = [
      {
        id: 'a',
        type: 'investigation',
        holeId: 1,
        startFrameIndex: 1,
        endFrameIndex: 2,
        startTimeUs: 5_500_000,
        endTimeUs: 5_900_000,
        entryOnsetTimeUs: null,
        completionTimeUs: null,
        censorBoundaryTimeUs: null,
        origin: 'manual',
        status: 'confirmed',
        confidence: 'medium',
        visitIndex: null,
        isRevisit: null,
        evidence: {},
        notes: null,
      },
      {
        id: 'b',
        type: 'investigation',
        holeId: 1,
        startFrameIndex: 10,
        endFrameIndex: 12,
        startTimeUs: 8_000_000,
        endTimeUs: 8_400_000,
        entryOnsetTimeUs: null,
        completionTimeUs: null,
        censorBoundaryTimeUs: null,
        origin: 'manual',
        status: 'confirmed',
        confidence: 'medium',
        visitIndex: null,
        isRevisit: null,
        evidence: {},
        notes: null,
      },
    ];
    const reindexed = reindexInvestigationVisits(events);
    expect(reindexed[1]?.visitIndex).toBe(2);
    expect(reindexed[1]?.isRevisit).toBe(true);
  });
});

describe('MS-5 merge rules', () => {
  it('preserves confirmed manual escape on re-detect', () => {
    const manualEscape: BehavioralEvent = {
      id: 'm1',
      type: 'escape_incomplete_censored',
      holeId: 2,
      startFrameIndex: 50,
      endFrameIndex: 80,
      startTimeUs: 10_000_000,
      endTimeUs: 15_000_000,
      entryOnsetTimeUs: 10_000_000,
      completionTimeUs: null,
      censorBoundaryTimeUs: 15_000_000,
      origin: 'manual',
      status: 'confirmed',
      confidence: 'medium',
      visitIndex: null,
      isRevisit: null,
      evidence: {},
      notes: null,
    };
    const autoEscape: BehavioralEvent = {
      ...manualEscape,
      id: 'a1',
      holeId: 3,
      origin: 'auto',
      status: 'proposed',
    };
    const merged = mergeDetectedEvents([manualEscape], [autoEscape]);
    expect(merged.filter((e) => e.type !== 'investigation')).toHaveLength(1);
    expect(merged[0]?.origin).toBe('manual');
  });
});
