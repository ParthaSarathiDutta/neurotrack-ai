import { describe, expect, it } from 'vitest';
import {
  computeCleanedTrajectory,
  gapInterpolationFactor,
  handleOutliers,
  interpolateBodies,
  smoothBodies,
} from '../src/domain/trajectory/cleaning';
import { isEstimatedBodyPosition } from '../src/domain/trajectory/observationEstimate';
import { applyManualCorrections } from '../src/domain/trajectory/manualCorrection';
import {
  consumableCleanedObservations,
  mergeCleaningWithManual,
  observationAtFrame,
  resolveEffectiveObservations,
} from '../src/domain/trajectory/resolveObservations';
import type { Observation, Track } from '../src/domain/types';
import { defaultCleaningParams, defaultTrackingParams } from '../src/domain/trialFactory';

const DEFAULT_GAP_US = 500_000;

function obs(
  frameIndex: number,
  timeUs: number,
  body: { x: number; y: number } | null,
  observed: Observation['observed'] = 'tracked',
  origin: Observation['origin'] = 'auto',
  qualityFlags: Observation['qualityFlags'] = null,
): Observation {
  return {
    frameIndex,
    timeUs,
    bodyXY: body,
    noseXY: null,
    confidence: body ? 0.8 : 0,
    observed,
    origin,
    qualityFlags,
  };
}

describe('trajectory correction and cleaning', () => {
  it('manual correction overrides raw by frameIndex without mutating raw', () => {
    const raw = [obs(0, 1_000_000, { x: 10, y: 10 }), obs(1, 1_100_000, { x: 20, y: 20 })];
    const corrections = [
      {
        frameIndex: 1,
        timeUs: 1_100_000,
        bodyXY: { x: 99, y: 88 },
        noseXY: null,
        correctedAt: 't',
      },
    ];
    const effective = applyManualCorrections(raw, corrections);
    expect(raw[1].bodyXY).toEqual({ x: 20, y: 20 });
    expect(effective[1].origin).toBe('manual');
    expect(effective[1].bodyXY).toEqual({ x: 99, y: 88 });
  });

  it('duplicate timeUs frames accept independent corrections by frameIndex', () => {
    const shared = 7_066_667;
    const raw = [
      obs(209, shared, { x: 1, y: 1 }),
      obs(210, shared, { x: 2, y: 2 }),
    ];
    const corrections = [
      {
        frameIndex: 210,
        timeUs: shared,
        bodyXY: { x: 50, y: 60 },
        noseXY: null,
        correctedAt: 't',
      },
    ];
    const effective = applyManualCorrections(raw, corrections);
    expect(effective.find((o) => o.frameIndex === 209)?.bodyXY).toEqual({ x: 1, y: 1 });
    expect(effective.find((o) => o.frameIndex === 210)?.bodyXY).toEqual({ x: 50, y: 60 });
  });

  it('interpolates short lost gaps and preserves observed status', () => {
    const base = [
      obs(0, 0, { x: 0, y: 0 }),
      obs(1, 33_333, null, 'lost'),
      obs(2, 66_666, { x: 30, y: 0 }),
    ];
    const filled = interpolateBodies(base, 3, DEFAULT_GAP_US);
    expect(filled[1].bodyXY).not.toBeNull();
    expect(filled[1].origin).toBe('interpolated');
    expect(filled[1].observed).toBe('lost');
    expect(filled[1].qualityFlags).toContain('gap_interpolated');
    expect(isEstimatedBodyPosition(filled[1])).toBe(true);
  });

  it('does not fill absent_in_hole or absent_pre_trial frames', () => {
    const base = [
      obs(0, 0, { x: 0, y: 0 }),
      obs(1, 100_000, null, 'absent_in_hole'),
      obs(2, 200_000, { x: 20, y: 0 }),
      obs(3, 300_000, null, 'absent_pre_trial'),
      obs(4, 400_000, { x: 40, y: 0 }),
    ];
    const filled = interpolateBodies(base, 3, DEFAULT_GAP_US);
    expect(filled[1].bodyXY).toBeNull();
    expect(filled[3].bodyXY).toBeNull();
  });

  it('does not fill gaps longer than maxGapFrames', () => {
    const base = [
      obs(0, 0, { x: 0, y: 0 }),
      obs(1, 33_333, null, 'lost'),
      obs(2, 66_666, null, 'lost'),
      obs(3, 99_999, null, 'lost'),
      obs(4, 133_332, { x: 40, y: 0 }),
    ];
    const filled = interpolateBodies(base, 2, DEFAULT_GAP_US);
    expect(filled[1].bodyXY).toBeNull();
    expect(filled[2].bodyXY).toBeNull();
    expect(filled[3].bodyXY).toBeNull();
  });

  it('does not fill when bracket span exceeds maxGapDurationUs', () => {
    const base = [
      obs(0, 0, { x: 0, y: 0 }),
      obs(1, 600_000, null, 'lost'),
      obs(2, 700_000, { x: 30, y: 0 }),
    ];
    const filled = interpolateBodies(base, 3, 500_000);
    expect(filled[1].bodyXY).toBeNull();
  });

  it('mergeCleaningWithManual preserves manual over cleaned at same frameIndex', () => {
    const corrected = [
      obs(0, 0, { x: 5, y: 5 }, 'tracked', 'manual'),
      obs(1, 100, { x: 10, y: 10 }),
    ];
    const cleaned = [
      obs(0, 0, { x: 1, y: 1 }, 'tracked', 'smoothed'),
      obs(1, 100, { x: 12, y: 12 }, 'tracked', 'smoothed'),
    ];
    const merged = mergeCleaningWithManual(corrected, cleaned, [
      {
        frameIndex: 0,
        timeUs: 0,
        bodyXY: { x: 5, y: 5 },
        noseXY: null,
        correctedAt: 't',
      },
    ]);
    expect(merged[0].origin).toBe('manual');
    expect(merged[1].origin).toBe('smoothed');
  });

  it('resolveEffectiveObservations ignores stale applied cleaning', () => {
    const track: Track = {
      status: 'done',
      observations: [obs(0, 0, { x: 1, y: 1 })],
      manualCorrections: [],
      appliedCleaning: {
        observations: [obs(0, 0, { x: 9, y: 9 }, 'tracked', 'smoothed')],
        params: defaultCleaningParams(),
        appliedAt: 't',
        stale: true,
        staleReason: 'stale',
      },
      quality: null,
      params: defaultTrackingParams(),
      computedAt: null,
      error: null,
    };
    expect(resolveEffectiveObservations(track)[0].origin).toBe('auto');
    expect(consumableCleanedObservations(track)).toBeNull();
  });

  it('resolveEffectiveObservations uses preview then active applied cleaning', () => {
    const track: Track = {
      status: 'done',
      observations: [obs(0, 0, { x: 1, y: 1 })],
      manualCorrections: [],
      appliedCleaning: null,
      quality: null,
      params: defaultTrackingParams(),
      computedAt: null,
      error: null,
    };
    const preview = [obs(0, 0, { x: 9, y: 9 }, 'tracked', 'smoothed')];
    expect(resolveEffectiveObservations(track, { cleaningPreview: preview })[0].origin).toBe(
      'smoothed',
    );
    track.appliedCleaning = {
      observations: [obs(0, 0, { x: 7, y: 7 }, 'tracked', 'interpolated')],
      params: defaultCleaningParams(),
      appliedAt: 't',
      stale: false,
      staleReason: null,
    };
    expect(resolveEffectiveObservations(track)[0].origin).toBe('interpolated');
  });

  it('observationAtFrame finds by frameIndex not timeUs', () => {
    const list = [obs(1, 100, { x: 1, y: 1 }), obs(2, 100, { x: 2, y: 2 })];
    expect(observationAtFrame(list, 2)?.bodyXY).toEqual({ x: 2, y: 2 });
  });

  it('gapInterpolationFactor uses frameIndex when timeUs duplicates', () => {
    const shared = 7_066_667;
    expect(gapInterpolationFactor(208, 210, 209, shared, shared, shared)).toBeCloseTo(0.5);
  });

  it('interpolates duplicate timeUs lost gap with spatial estimate flag', () => {
    const shared = 7_066_667;
    const base = [
      obs(208, shared, { x: 0, y: 0 }),
      obs(209, shared, null, 'lost'),
      obs(210, shared, { x: 20, y: 0 }),
    ];
    const filled = interpolateBodies(base, 3, DEFAULT_GAP_US);
    expect(filled[1].qualityFlags).toContain('duplicate_pts_spatial_estimate');
    expect(filled[1].qualityFlags).toContain('gap_interpolated');
    expect(filled[1].frameIndex).toBe(209);
  });

  it('marks speed outlier replacements with explicit flag', () => {
    const base = [
      obs(0, 0, { x: 0, y: 0 }),
      obs(1, 100_000, { x: 0, y: 0 }),
      obs(2, 200_000, { x: 400, y: 0 }, 'tracked', 'auto', ['speed_outlier']),
      obs(3, 300_000, { x: 400, y: 0 }),
    ];
    const cleaned = handleOutliers(base, 50);
    expect(cleaned[2].qualityFlags).toContain('speed_outlier');
    expect(cleaned[2].qualityFlags).toContain('speed_outlier_replaced');
    expect(cleaned[2].origin).toBe('interpolated');
  });

  it('does not smooth across absence boundaries or flagged transitions', () => {
    const base = [
      obs(0, 0, { x: 0, y: 0 }),
      obs(1, 33_333, { x: 10, y: 0 }),
      obs(2, 66_666, { x: 20, y: 0 }, 'tracked', 'auto', ['near_hole_disappearance']),
      obs(3, 100_000, { x: 30, y: 0 }),
    ];
    const smoothed = smoothBodies(base, 3);
    expect(smoothed[2].origin).toBe('auto');
    expect(smoothed[1].origin).toBe('auto');
  });

  it('computeCleanedTrajectory completes when pre-trial absent frames have null body', () => {
    const base = [
      obs(0, 0, null, 'absent_pre_trial'),
      obs(1, 33_333, null, 'absent_pre_trial'),
      obs(2, 66_666, { x: 10, y: 10 }),
      obs(3, 100_000, null, 'lost'),
      obs(4, 133_333, { x: 20, y: 10 }),
    ];
    const cleaned = computeCleanedTrajectory(
      base,
      { ...defaultCleaningParams(), maxGapFrames: 1, smoothingWindow: 3 },
      800,
    );
    expect(cleaned[0].bodyXY).toBeNull();
    expect(cleaned[3].bodyXY).not.toBeNull();
    expect(cleaned[3].observed).toBe('lost');
  });

  it('computeCleanedTrajectory skips speed outliers when deltaUs is zero', () => {
    const shared = 7_066_667;
    const base = [
      obs(209, shared, { x: 0, y: 0 }),
      obs(210, shared, { x: 500, y: 500 }, 'tracked', 'auto', ['speed_outlier']),
    ];
    const cleaned = computeCleanedTrajectory(
      base,
      { ...defaultCleaningParams(), smoothingWindow: 1, maxGapFrames: 0 },
      50,
    );
    expect(cleaned[1].bodyXY).toEqual({ x: 500, y: 500 });
  });
});
