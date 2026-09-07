import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTrajectorySegments } from '../src/domain/visualization/trajectorySegments';
import { buildHoleVisitTimelineModel } from '../src/domain/visualization/holeVisitTimeline';
import { buildOccupancyGrid, occupancyCellFraction } from '../src/domain/visualization/occupancyGrid';
import { filterInTrialObservations, isUnsupportedTrajectoryGap } from '../src/domain/visualization/trialObservations';
import { auditMaxSpeedInterval } from '../src/domain/measures/maxSpeedAudit';
import { resolveMeasurementObservations } from '../src/domain/trajectory/measurementObservations';
import { effectiveTrialStartUs, censorBoundaryTimeUs } from '../src/domain/events/holeProximity';
import type { Observation } from '../src/domain/types';

const FIXTURE = join(process.cwd(), 'tests/fixtures/ms6/three-trial-session.neurotrack.json');

function loadTest53Trial() {
  const bundle = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  return bundle.trials.find((t: { trial: { fileName: string } }) =>
    t.trial.fileName.includes('test53'),
  )!.trial;
}

describe('MS-6 trajectory segments', () => {
  it('does not connect across lost frames', () => {
    const obs: Observation[] = [
      {
        frameIndex: 0,
        timeUs: 0,
        bodyXY: { x: 0, y: 0 },
        noseXY: null,
        confidence: 1,
        observed: 'tracked',
        origin: 'auto',
        qualityFlags: null,
      },
      {
        frameIndex: 1,
        timeUs: 33_333,
        bodyXY: null,
        noseXY: null,
        confidence: 0,
        observed: 'lost',
        origin: 'auto',
        qualityFlags: ['lost'],
      },
      {
        frameIndex: 2,
        timeUs: 66_666,
        bodyXY: { x: 10, y: 0 },
        noseXY: null,
        confidence: 1,
        observed: 'tracked',
        origin: 'auto',
        qualityFlags: null,
      },
      {
        frameIndex: 3,
        timeUs: 100_000,
        bodyXY: { x: 20, y: 0 },
        noseXY: null,
        confidence: 1,
        observed: 'tracked',
        origin: 'auto',
        qualityFlags: null,
      },
    ];
    const segments = buildTrajectorySegments(obs, 0, 200_000);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.points).toHaveLength(2);
  });

  it('splits provenance by segment', () => {
    const obs: Observation[] = [
      {
        frameIndex: 0,
        timeUs: 0,
        bodyXY: { x: 0, y: 0 },
        noseXY: null,
        confidence: 1,
        observed: 'tracked',
        origin: 'manual',
        qualityFlags: null,
      },
      {
        frameIndex: 1,
        timeUs: 33_333,
        bodyXY: { x: 5, y: 0 },
        noseXY: null,
        confidence: 1,
        observed: 'tracked',
        origin: 'manual',
        qualityFlags: null,
      },
    ];
    const segments = buildTrajectorySegments(obs, 0, 100_000);
    expect(segments[0]?.provenance).toBe('manual');
  });
});

describe('MS-6 hole visit timeline', () => {
  it('maps hole display numbers 1–20 and investigation spans', () => {
    const trial = loadTest53Trial();
    const start = effectiveTrialStartUs(trial.trialWindow)!;
    const censor = censorBoundaryTimeUs(trial.trialWindow, trial.timestampIndex)!;
    const model = buildHoleVisitTimelineModel(
      trial.events.events,
      start,
      censor,
      trial.trialWindow.startTimeUs,
    );
    expect(model.holeDisplays).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(model.investigations.length).toBeGreaterThan(0);
    expect(model.investigations.every((i) => i.holeDisplay >= 1 && i.holeDisplay <= 20)).toBe(true);
    expect(model.escapeMarkers.some((m) => m.kind === 'completion')).toBe(true);
  });
});

describe('MS-6 occupancy grid', () => {
  it('excludes zero-dt pairs from time weighting', () => {
    const obs: Observation[] = [
      {
        frameIndex: 0,
        timeUs: 1_000_000,
        bodyXY: { x: 100, y: 100 },
        noseXY: null,
        confidence: 1,
        observed: 'tracked',
        origin: 'auto',
        qualityFlags: null,
      },
      {
        frameIndex: 1,
        timeUs: 1_000_000,
        bodyXY: { x: 110, y: 100 },
        noseXY: null,
        confidence: 1,
        observed: 'tracked',
        origin: 'auto',
        qualityFlags: null,
      },
      {
        frameIndex: 2,
        timeUs: 1_033_333,
        bodyXY: { x: 120, y: 100 },
        noseXY: null,
        confidence: 1,
        observed: 'tracked',
        origin: 'auto',
        qualityFlags: null,
      },
    ];
    const geometry = {
      platformCenter: { x: 100, y: 100 },
      platformRadiusPx: 50,
      pxPerCm: null,
      holes: [],
      targetHoleId: null,
      proposedTargetHoleId: null,
      targetHoleConfirmedAt: null,
      confirmedAt: null,
      diameterCm: null,
    };
    const grid = buildOccupancyGrid(obs, geometry, 1_000_000, 2_000_000);
    expect(grid.excludedZeroDtPairs).toBe(1);
    expect(grid.totalWeightUs).toBe(33_333);
    expect(grid.totalWeightUs).toBeGreaterThan(0);
    const maxCell = Math.max(...grid.weights);
    expect(occupancyCellFraction(maxCell, grid.totalWeightUs)).toBe(1);
  });
});

describe('MS-6 max speed policy (test53 fixture)', () => {
  it('documents compression pair excluded from gated max while preserved as diagnostic', () => {
    const trial = loadTest53Trial();
    const start = effectiveTrialStartUs(trial.trialWindow)!;
    const censor = censorBoundaryTimeUs(trial.trialWindow, trial.timestampIndex)!;
    const { observations } = resolveMeasurementObservations(trial.track, 'corrected');
    const audit = auditMaxSpeedInterval(observations, start, censor);
    expect(audit).not.toBeNull();
    expect(audit!.currFrameIndex).toBe(812);
    expect(audit!.excludedByPolicy).toBe(true);
    expect(audit!.maxSpeedPxPerSec).toBeGreaterThan(10_000);
    expect(audit!.maxSpeedQualityGatedPxPerSec).toBeLessThan(1000);
  });
});

describe('MS-6 basis selection for visualization inputs', () => {
  it('returns unavailable for cleaned basis when applied cleaning stale', () => {
    const trial = loadTest53Trial();
    const staleTrack = {
      ...trial.track,
      appliedCleaning: {
        observations: trial.track.appliedCleaning?.observations ?? [],
        params: trial.track.appliedCleaning?.params ?? trial.track.observations,
        computedAt: '2020-01-01',
        stale: true,
        staleReason: 'test',
      },
    };
    const resolved = resolveMeasurementObservations(staleTrack, 'cleaned');
    expect(resolved.unavailable).toBe(true);
  });

  it('filters absent_pre_trial from in-trial visualization observations', () => {
    const trial = loadTest53Trial();
    const start = effectiveTrialStartUs(trial.trialWindow)!;
    const censor = censorBoundaryTimeUs(trial.trialWindow, trial.timestampIndex)!;
    const { observations } = resolveMeasurementObservations(trial.track, 'corrected');
    const inTrial = filterInTrialObservations(observations, start, censor);
    expect(inTrial.every((o) => o.observed !== 'absent_pre_trial')).toBe(true);
    expect(inTrial.some((o) => isUnsupportedTrajectoryGap(o)) || inTrial.length > 0).toBe(true);
  });
});
