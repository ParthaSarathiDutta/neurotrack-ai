import { describe, expect, it } from 'vitest';
import { isInvestigationConfirmed, isInvestigationProvisional } from '../src/domain/events/eventMerge';
import { computePathSpeedMetrics } from '../src/domain/measures/pathMetrics';
import { computeErrorCounts } from '../src/domain/measures/errorCounts';
import { detectEvents } from '../src/domain/events/detectEvents';
import { computeMeasures } from '../src/domain/measures/computeMeasures';
import { defaultEventDetectionParams, defaultOperationalDefinitions } from '../src/domain/trialFactory';
import type { BehavioralEvent, Geometry, Observation, TrialWindow } from '../src/domain/types';

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
  };
}

describe('MS-5 path metrics', () => {
  it('includes duplicate PTS displacement in path but excludes from speed', () => {
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

describe('MS-5 event status vs confidence', () => {
  it('confirmed low-confidence counts as confirmed not provisional', () => {
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

  it('proposed low-confidence stays provisional', () => {
    const ev: BehavioralEvent = {
      ...({
        id: '2',
        type: 'investigation',
        holeId: 1,
        startFrameIndex: 20,
        endFrameIndex: 22,
        startTimeUs: 7_000_000,
        endTimeUs: 7_400_000,
        entryOnsetTimeUs: null,
        completionTimeUs: null,
        censorBoundaryTimeUs: null,
        origin: 'auto',
        status: 'proposed',
        confidence: 'low',
        visitIndex: 1,
        isRevisit: false,
        evidence: {},
        notes: null,
      } as BehavioralEvent),
    };
    expect(isInvestigationProvisional(ev)).toBe(true);
  });
});

describe('MS-5 censoring lower bound', () => {
  it('trial_censored_no_entry retains follow-up lower bound', () => {
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
