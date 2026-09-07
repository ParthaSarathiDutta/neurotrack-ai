import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computePathSpeedMetrics } from '../src/domain/measures/pathMetrics';
import {
  classifySpeedIntervalExclusion,
  isSpeedIntervalQualityValid,
  resolveSpeedIntervalReference,
  TIMESTAMP_COMPRESSION_MIN_REFERENCE_FRACTION,
} from '../src/domain/measures/speedIntervalValidity';
import { resolveMeasurementObservations } from '../src/domain/trajectory/measurementObservations';
import { effectiveTrialStartUs, censorBoundaryTimeUs } from '../src/domain/events/holeProximity';
import { computeMeasures } from '../src/domain/measures/computeMeasures';
import { defaultEventDetectionParams, defaultOperationalDefinitions } from '../src/domain/trialFactory';
import type { Observation } from '../src/domain/types';

const FIXTURE = join(process.cwd(), 'tests/fixtures/ms6/three-trial-session.neurotrack.json');

function obs(
  frameIndex: number,
  timeUs: number,
  x: number,
  y: number,
  extra: Partial<Observation> = {},
): Observation {
  return {
    frameIndex,
    timeUs,
    bodyXY: { x, y },
    noseXY: null,
    confidence: 1,
    observed: 'tracked',
    origin: 'auto',
    qualityFlags: null,
    ...extra,
  };
}

function loadTest53Trial() {
  const bundle = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  return bundle.trials.find((t: { trial: { fileName: string } }) =>
    t.trial.fileName.includes('test53'),
  )!.trial;
}

describe('speed_interval_validity.v1', () => {
  it('uses median observation interval as reference, not a fixed millisecond cutoff', () => {
    const observations = [
      obs(0, 0, 0, 0),
      obs(1, 20_000, 1, 0),
      obs(2, 40_000, 2, 0),
      obs(3, 60_000, 3, 0),
    ];
    const ref = resolveSpeedIntervalReference(observations, undefined, 0, 100_000);
    expect(ref.referenceIntervalUs).toBe(20_000);
    const minValid = 20_000 * TIMESTAMP_COMPRESSION_MIN_REFERENCE_FRACTION;
    expect(isSpeedIntervalQualityValid(minValid, ref.referenceIntervalUs, observations[0]!, observations[1]!)).toBe(true);
    expect(isSpeedIntervalQualityValid(minValid - 1, ref.referenceIntervalUs, observations[0]!, observations[1]!)).toBe(false);
  });

  it('excludes duplicate timestamps from speed but keeps path displacement', () => {
    const observations = [
      obs(0, 1_000_000, 0, 0),
      obs(1, 1_000_000, 3, 4),
      obs(2, 1_100_000, 13, 4),
    ];
    const m = computePathSpeedMetrics(observations, 1_000_000, 2_000_000);
    expect(m.pathLengthPx).toBe(15);
    expect(m.excludedZeroDtPairs).toBe(1);
    expect(m.rawSpeedIntervalCount).toBe(1);
    expect(m.qualityGatedIntervalCount).toBe(1);
  });

  it('removes test53 frames 811→812 compression spike from scientific max speed', () => {
    const trial = loadTest53Trial();
    const start = effectiveTrialStartUs(trial.trialWindow)!;
    const censor = censorBoundaryTimeUs(trial.trialWindow, trial.timestampIndex)!;
    const { observations } = resolveMeasurementObservations(trial.track, 'corrected');
    const m = computePathSpeedMetrics(observations, start, censor, trial.timestampIndex);

    expect(m.excludedTimestampCompressionPairs).toBeGreaterThan(0);
    expect(m.maxSpeedRawPxPerSec).toBeGreaterThan(10_000);
    expect(m.maxSpeedPxPerSec).toBeLessThan(1000);
    expect(m.maxSpeedPxPerSec).toBeLessThan(m.maxSpeedRawPxPerSec / 10);

    const compressionPair = classifySpeedIntervalExclusion(
      65,
      m.referenceIntervalUs,
      observations.find((o) => o.frameIndex === 811)!,
      observations.find((o) => o.frameIndex === 812)!,
    );
    expect(compressionPair).toBe('timestamp_compression');
  });

  it('preserves genuine large displacements at normal frame spacing', () => {
    const observations = [
      obs(0, 1_000_000, 0, 0),
      obs(1, 1_033_333, 100, 0),
    ];
    const m = computePathSpeedMetrics(observations, 1_000_000, 2_000_000);
    expect(m.qualityGatedIntervalCount).toBe(1);
    expect(m.maxSpeedPxPerSec).toBeCloseTo(m.maxSpeedRawPxPerSec, 5);
    expect(m.maxSpeedPxPerSec).toBeGreaterThan(500);
  });

  it('computeMeasures emits v2 gated speed and diagnostic snapshots', () => {
    const trial = loadTest53Trial();
    const start = effectiveTrialStartUs(trial.trialWindow)!;
    const { observations } = resolveMeasurementObservations(trial.track, 'corrected');
    const measures = computeMeasures(
      observations,
      trial.events.events,
      trial.geometry,
      trial.trialWindow,
      trial.timestampIndex,
      defaultEventDetectionParams(),
      defaultOperationalDefinitions(),
      'corrected',
    );
    expect(measures).not.toBeNull();
    expect(measures!.maxSpeed.definitionId).toBe('max_speed.v2');
    expect(measures!.maxSpeedDiagnostic?.definitionId).toBe('max_speed_diagnostic.v1');
    expect(measures!.maxSpeedDiagnostic!.value!).toBeGreaterThan(10_000);
    expect(measures!.maxSpeed.value!).toBeLessThan(1000);
    expect(measures!.maxSpeed.assumptions.some((a) => a.includes('excluded_timestamp_compression'))).toBe(true);
    expect(measures!.totalLatency.value).toBeCloseTo(24.4, 1);
    void start;
  });
});
