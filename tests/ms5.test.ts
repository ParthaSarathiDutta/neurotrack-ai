import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isInvestigationConfirmed, isInvestigationProvisional, mergeDetectedEvents } from '../src/domain/events/eventMerge';
import { computePathSpeedMetrics } from '../src/domain/measures/pathMetrics';
import { computeErrorCounts } from '../src/domain/measures/errorCounts';
import { detectEvents } from '../src/domain/events/detectEvents';
import { detectEscapeOutcome } from '../src/domain/events/escape';
import { computeMeasures } from '../src/domain/measures/computeMeasures';
import { selectPixelEvidenceFrameIndices } from '../src/domain/events/pixelEvidence';
import { detectInvestigations } from '../src/domain/events/investigations';
import { defaultEventDetectionParams, defaultOperationalDefinitions } from '../src/domain/trialFactory';
import type { BehavioralEvent, Geometry, Observation, TrialWindow } from '../src/domain/types';

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

describe('MS-5 path metrics', () => {
  it('includes duplicate PTS displacement in path but excludes from speed (U11)', () => {
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

  it('time-weighted mean speed differs from unweighted frame mean (U12)', () => {
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

describe('MS-5 event status vs confidence', () => {
  it('confirmed low-confidence counts as confirmed not provisional (U5)', () => {
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
  });
});

describe('MS-5 censoring lower bound', () => {
  it('trial_censored_no_entry retains follow-up lower bound (U9)', () => {
    const observations: Observation[] = [];
    for (let i = 0; i < 100; i += 1) {
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
    const esc = analysis.events.find((e) => e.type === 'trial_censored_no_entry');
    expect(esc).toBeTruthy();
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
    expect(measures?.totalLatency.censored).toBe(true);
    expect(measures?.totalLatency.lowerBound).toBeGreaterThan(0);
  });
});

describe('MS-5 escape states', () => {
  it('escape_completed yields numeric total latency (U7)', () => {
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
    expect(measures?.totalLatency.value).toBeGreaterThan(0);
  });

  it('incomplete pixel evidence does not force escape_completed (U14)', () => {
    const hole = geometry.holes[0]!;
    const observations: Observation[] = [];
    for (let i = 0; i < 80; i += 1) {
      const t = 5_000_000 + i * 100_000;
      observations.push(obs(i, t, hole.x, hole.y, { x: hole.x, y: hole.y - 5 }));
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

  it('rim proximity without sustained entry yields no escape record (U6)', () => {
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

describe('MS-5 pixel frame selection', () => {
  it('selects trailing frames when budget exceeded', () => {
    const ts = Array.from({ length: 500 }, (_, i) => ({ frameIndex: i, timeUs: i * 100_000 }));
    const selected = selectPixelEvidenceFrameIndices(ts, 0, 499, 50);
    expect(selected.length).toBe(50);
    expect(selected[0]).toBe(450);
    expect(selected[49]).toBe(499);
  });
});

describe('MS-5 investigation dwell timing', () => {
  it('uses timeUs for dwell not frame count (U1)', () => {
    const h0 = geometry.holes[0]!;
    const params = { ...defaultEventDetectionParams(), investigationMinDwellUs: 500_000 };
    const observations: Observation[] = [
      obs(0, 5_000_000, h0.x, h0.y, { x: h0.x, y: h0.y - 3 }),
      obs(1, 5_600_000, h0.x, h0.y, { x: h0.x, y: h0.y - 3 }),
    ];
    const ts = observations.map((o) => ({ timeUs: o.timeUs, frameIndex: o.frameIndex }));
    const events = detectInvestigations(observations, geometry, trialWindow, ts, params);
    expect(events).toHaveLength(1);
    expect(events[0]?.evidence.dwellUs).toBe(600_000);
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

describe('MS-5 target unknown', () => {
  it('target-dependent measures unavailable without confirmed target (U18)', () => {
    const observations = [obs(0, 5_500_000, 320, 240)];
    const events: BehavioralEvent[] = [];
    const measures = computeMeasures(
      observations,
      events,
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

describe('MS-5 error counts', () => {
  it('rejected events never count', () => {
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
        origin: 'auto',
        status: 'rejected',
        confidence: 'high',
        visitIndex: 1,
        isRevisit: false,
        evidence: {},
        notes: null,
      },
      {
        id: 'b',
        type: 'investigation',
        holeId: 5,
        startFrameIndex: 10,
        endFrameIndex: 12,
        startTimeUs: 8_000_000,
        endTimeUs: 8_400_000,
        entryOnsetTimeUs: null,
        completionTimeUs: null,
        censorBoundaryTimeUs: null,
        origin: 'auto',
        status: 'confirmed',
        confidence: 'high',
        visitIndex: 1,
        isRevisit: false,
        evidence: {},
        notes: null,
      },
    ];
    const counts = computeErrorCounts(events, geometry, 8_000_000, 30_000_000);
    expect(counts.confirmed.total).toBe(0);
  });
});
