import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildOccupancyGrid,
  occupancyCellColor,
  occupancyDisplayIntensity,
  summarizeOccupancyAccounting,
} from '../src/domain/visualization/occupancyGrid';
import { resolveMeasurementObservations } from '../src/domain/trajectory/measurementObservations';
import { effectiveTrialStartUs, censorBoundaryTimeUs } from '../src/domain/events/holeProximity';

const FIXTURE = join(process.cwd(), 'tests/fixtures/ms6/three-trial-session.neurotrack.json');

function loadTrial(name: string) {
  const bundle = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  return bundle.trials.find((t: { trial: { fileName: string } }) =>
    t.trial.fileName.includes(name),
  )!.trial;
}

describe('MS-6 occupancy accounting', () => {
  it('test51: included + off-platform + gaps reconciles observation span (expected, not defect)', () => {
    const trial = loadTrial('test51');
    const start = effectiveTrialStartUs(trial.trialWindow)!;
    const censor = censorBoundaryTimeUs(trial.trialWindow, trial.timestampIndex)!;
    const { observations } = resolveMeasurementObservations(trial.track, 'corrected');
    const grid = buildOccupancyGrid(observations, trial.geometry, start, censor);
    const accounting = summarizeOccupancyAccounting(grid);

    expect(accounting.trialDurationSec).toBeCloseTo(44.2442, 2);
    expect(accounting.includedWeightSec).toBeCloseTo(33.17, 1);
    expect(accounting.excludedOffPlatformSec).toBeCloseTo(11.08, 1);
    expect(accounting.excludedGapSec).toBe(0);
    expect(accounting.excludedZeroDtPairs).toBe(17);
    expect(accounting.reconciledObservationSpanSec).toBeCloseTo(44.2442, 2);
    expect(accounting.unaccountedSec).toBeLessThan(0.001);
  });

  it('uses linear seconds-per-bin display normalization with monotonic color ramp', () => {
    expect(occupancyDisplayIntensity(0, 10)).toBe(0);
    expect(occupancyDisplayIntensity(5, 10)).toBe(0.5);
    expect(occupancyDisplayIntensity(10, 10)).toBe(1);
    const low = occupancyCellColor(0.2);
    const high = occupancyCellColor(0.9);
    expect(low).not.toBe(high);
    expect(low).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });
});

describe('MS-6 visualization quality metadata', () => {
  it('occupancy grid exposes trial duration and off-platform exclusions', () => {
    const trial = loadTrial('test53');
    const start = effectiveTrialStartUs(trial.trialWindow)!;
    const censor = censorBoundaryTimeUs(trial.trialWindow, trial.timestampIndex)!;
    const { observations } = resolveMeasurementObservations(trial.track, 'corrected');
    const grid = buildOccupancyGrid(observations, trial.geometry, start, censor);
    expect(grid.trialDurationUs).toBeGreaterThan(0);
    expect(grid.displayNormalization).toBe('linear_seconds_per_bin');
    expect(grid.totalWeightUs).toBeGreaterThan(0);
  });
});
