import { describe, expect, it } from 'vitest';
import { computeCleanedTrajectory, interpolateBodies } from '../src/domain/trajectory/cleaning';
import {
  applyManualCorrections,
} from '../src/domain/trajectory/manualCorrection';
import {
  mergeCleaningWithManual,
  observationAtFrame,
  resolveEffectiveObservations,
} from '../src/domain/trajectory/resolveObservations';
import type { Observation, Track } from '../src/domain/types';
import { defaultCleaningParams, defaultTrackingParams } from '../src/domain/trialFactory';

function obs(
  frameIndex: number,
  timeUs: number,
  body: { x: number; y: number } | null,
  observed: Observation['observed'] = 'tracked',
  origin: Observation['origin'] = 'auto',
): Observation {
  return {
    frameIndex,
    timeUs,
    bodyXY: body,
    noseXY: null,
    confidence: body ? 0.8 : 0,
    observed,
    origin,
    qualityFlags: null,
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
    expect(effective.find((o) => o.frameIndex === 209)?.origin).toBe('auto');
    expect(effective.find((o) => o.frameIndex === 210)?.bodyXY).toEqual({ x: 50, y: 60 });
    expect(effective.find((o) => o.frameIndex === 210)?.origin).toBe('manual');
    expect(effective[0].timeUs).toBe(effective[1].timeUs);
  });

  it('interpolates only short gaps and marks origin interpolated', () => {
    const base = [
      obs(0, 0, { x: 0, y: 0 }),
      obs(1, 33_333, null, 'lost'),
      obs(2, 66_666, { x: 30, y: 0 }),
    ];
    const filled = interpolateBodies(base, 3);
    expect(filled[1].bodyXY).not.toBeNull();
    expect(filled[1].origin).toBe('interpolated');
    expect(filled[1].noseXY).toBeNull();
  });

  it('does not fill gaps longer than maxGapFrames', () => {
    const base = [
      obs(0, 0, { x: 0, y: 0 }),
      obs(1, 33_333, null, 'lost'),
      obs(2, 66_666, null, 'lost'),
      obs(3, 99_999, null, 'lost'),
      obs(4, 133_332, { x: 40, y: 0 }),
    ];
    const filled = interpolateBodies(base, 2);
    expect(filled[1].bodyXY).toBeNull();
    expect(filled[2].bodyXY).toBeNull();
    expect(filled[3].bodyXY).toBeNull();
  });

  it('mergeCleaningWithManual preserves manual over cleaned at same frameIndex', () => {
    const corrected = [
      obs(0, 0, { x: 5, y: 5 }, 'tracked', 'manual'),
      obs(1, 100, { x: 10, y: 10 }, 'tracked', 'auto'),
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
    expect(merged[0].bodyXY).toEqual({ x: 5, y: 5 });
    expect(merged[0].origin).toBe('manual');
    expect(merged[1].origin).toBe('smoothed');
  });

  it('resolveEffectiveObservations uses preview then applied cleaning', () => {
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
    };
    expect(resolveEffectiveObservations(track)[0].origin).toBe('interpolated');
  });

  it('observationAtFrame finds by frameIndex not timeUs', () => {
    const list = [
      obs(1, 100, { x: 1, y: 1 }),
      obs(2, 100, { x: 2, y: 2 }),
    ];
    expect(observationAtFrame(list, 2)?.bodyXY).toEqual({ x: 2, y: 2 });
  });

  it('computeCleanedTrajectory smooth changes auto positions', () => {
    const base = [
      obs(0, 0, { x: 0, y: 0 }),
      obs(1, 33_333, { x: 10, y: 0 }),
      obs(2, 66_666, { x: 20, y: 0 }),
    ];
    const cleaned = computeCleanedTrajectory(base, { ...defaultCleaningParams(), smoothingWindow: 3 }, 800);
    expect(cleaned.some((o) => o.origin === 'smoothed')).toBe(true);
  });
});
