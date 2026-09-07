import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeOccupancyBinDistribution,
  buildOccupancyGrid,
  occupancyCellColor,
  occupancyColorLuminance,
  occupancyDisplayIntensity,
  occupancyHoleLabelPosition,
  occupancyLegendIntensity,
  resolveOccupancyDisplayNormalization,
} from '../src/domain/visualization/occupancyGrid';
import { buildHoleVisitTimelineModel } from '../src/domain/visualization/holeVisitTimeline';
import { resolveTimelineLegend, LEGEND_ABSENT_LABELS } from '../src/domain/visualization/timelineLegend';
import { resolveMeasurementObservations } from '../src/domain/trajectory/measurementObservations';
import { effectiveTrialStartUs, censorBoundaryTimeUs } from '../src/domain/events/holeProximity';

const FIXTURE = join(process.cwd(), 'tests/fixtures/ms6/three-trial-session.neurotrack.json');

function loadTrial(name: string) {
  const bundle = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  return bundle.trials.find((t: { trial: { fileName: string } }) =>
    t.trial.fileName.includes(name),
  )!.trial;
}

function occupancyGridForTrial(name: string) {
  const trial = loadTrial(name);
  const start = effectiveTrialStartUs(trial.trialWindow)!;
  const censor = censorBoundaryTimeUs(trial.trialWindow, trial.timestampIndex)!;
  const { observations } = resolveMeasurementObservations(trial.track, 'corrected');
  return buildOccupancyGrid(observations, trial.geometry, start, censor);
}

function timelineModelForTrial(name: string) {
  const trial = loadTrial(name);
  const start = effectiveTrialStartUs(trial.trialWindow)!;
  const censor = censorBoundaryTimeUs(trial.trialWindow, trial.timestampIndex)!;
  return buildHoleVisitTimelineModel(
    trial.events.events,
    start,
    censor,
    trial.trialWindow.startTimeUs,
  );
}

describe('timeline legend resolution', () => {
  it('test53 shows only categories present in trial data', () => {
    const model = timelineModelForTrial('test53');
    const legend = resolveTimelineLegend(model, model.investigations);
    expect(legend.present).toContain('proposed_investigation');
    expect(legend.present).toContain('confirmed_completion');
    expect(legend.present).toContain('entry_onset');
    expect(legend.absent).toContain('confirmed_investigation');
    expect(legend.absent).toContain('candidate_entry');
    expect(legend.absent).toContain('manual_provenance');
  });

  it('test51 shows candidate entry but not confirmed completion', () => {
    const model = timelineModelForTrial('test51');
    const legend = resolveTimelineLegend(model, model.investigations);
    expect(legend.present).toContain('candidate_entry');
    expect(legend.absent).toContain('confirmed_completion');
  });

  it('uses concise absent-category labels', () => {
    expect(LEGEND_ABSENT_LABELS.candidate_entry).toBe('Candidate entry');
    expect(LEGEND_ABSENT_LABELS.confirmed_completion).toBe('Confirmed completion');
  });
});

describe('occupancy display normalization', () => {
  it('test51: skewed distribution selects sqrt display mapping', () => {
    const grid = occupancyGridForTrial('test51');
    const stats = analyzeOccupancyBinDistribution(grid.weights, grid.maxWeightUs);
    expect(stats.nonzeroCount).toBeGreaterThan(8);
    expect(stats.maxOverMedian).toBeGreaterThan(4);
    expect(stats.aboveHalfMaxCount).toBeLessThanOrEqual(4);
    expect(grid.displayNormalization).toBe('sqrt_seconds_per_bin');
  });

  it('test53: skewed distribution selects sqrt display mapping', () => {
    const grid = occupancyGridForTrial('test53');
    const stats = analyzeOccupancyBinDistribution(grid.weights, grid.maxWeightUs);
    expect(stats.nonzeroCount).toBeGreaterThan(8);
    expect(stats.maxOverMedian).toBeGreaterThan(4);
    expect(grid.displayNormalization).toBe('sqrt_seconds_per_bin');
  });

  it('sqrt mapping expands mid-range contrast without changing bin weights', () => {
    const linear = occupancyDisplayIntensity(2_500_000, 10_000_000, 'linear_seconds_per_bin');
    const sqrt = occupancyDisplayIntensity(2_500_000, 10_000_000, 'sqrt_seconds_per_bin');
    expect(sqrt).toBeGreaterThan(linear);
    expect(occupancyDisplayIntensity(10_000_000, 10_000_000, 'sqrt_seconds_per_bin')).toBe(1);
  });

  it('legend gradient uses display normalization, ticks remain true seconds', () => {
    const norm = 'sqrt_seconds_per_bin';
    expect(occupancyLegendIntensity(0.5, norm)).toBeCloseTo(Math.sqrt(0.5), 5);
    expect(occupancyLegendIntensity(1, norm)).toBe(1);
  });

  it('color ramp darkens monotonically with intensity (grayscale-readable)', () => {
    const light = occupancyColorLuminance(occupancyCellColor(0.1));
    const mid = occupancyColorLuminance(occupancyCellColor(0.5));
    const dark = occupancyColorLuminance(occupancyCellColor(0.95));
    expect(light - mid).toBeGreaterThan(0.08);
    expect(mid - dark).toBeGreaterThan(0.08);
  });
});

describe('occupancy hole label placement', () => {
  it('places labels inward from platform edge toward center', () => {
    const center = { x: 320, y: 240 };
    const radius = 200;
    const hole = { x: 520, y: 240 };
    const pos = occupancyHoleLabelPosition(hole.x, hole.y, center, radius, 300, 20);
    expect(pos.lx).toBeLessThan(300);
    expect(pos.cx).toBeGreaterThan(pos.lx);
  });
});

describe('occupancy normalization resolver', () => {
  it('keeps linear mapping when bins are evenly spread', () => {
    const weights = new Float64Array(16);
    for (let i = 0; i < 16; i += 1) weights[i] = (i + 1) * 1_000_000;
    expect(resolveOccupancyDisplayNormalization(weights, 16_000_000)).toBe('linear_seconds_per_bin');
  });
});
