import { describe, expect, it } from 'vitest';
import { defaultCleaningParams } from '../src/domain/trialFactory';
import type { Observation } from '../src/domain/types';
import {
  bodyDisplacementPx,
  compareCleaningPreviewFrame,
  formatCleaningPreviewCompareLine,
  isMeaningfulPreviewBodyChange,
} from '../src/domain/trajectory/cleaningPreviewCompare';
import { computeCleanedTrajectory, smoothBodies } from '../src/domain/trajectory/cleaning';

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
    confidence: 0.9,
    observed,
    origin,
    qualityFlags,
  };
}

describe('cleaningPreviewCompare', () => {
  it('detects meaningful smoothing displacement', () => {
    const base = [
      obs(0, 0, { x: 0, y: 0 }),
      obs(1, 33_333, { x: 10, y: 0 }),
      obs(2, 66_666, { x: 30, y: 0 }),
      obs(3, 100_000, { x: 40, y: 0 }),
    ];
    const preview = smoothBodies(base, 3);
    const compare = compareCleaningPreviewFrame(
      base,
      preview,
      [],
      2,
      { ...defaultCleaningParams(), smoothingWindow: 3 },
    );
    expect(compare?.meaningfulChange).toBe(true);
    expect(compare?.previewOrigin).toBe('smoothed');
    expect(compare?.displacementPx).not.toBeNull();
    expect((compare?.displacementPx ?? 0) >= 0.5).toBe(true);
    expect(compare?.skipNote).toBeNull();
  });

  it('explains smoothing skipped when shift is below threshold', () => {
    const base = [
      obs(0, 0, { x: 0, y: 0 }),
      obs(1, 33_333, { x: 1, y: 0 }),
      obs(2, 66_666, { x: 2, y: 0 }),
      obs(3, 100_000, { x: 3, y: 0 }),
    ];
    const preview = smoothBodies(base, 7);
    const compare = compareCleaningPreviewFrame(
      base,
      preview,
      [],
      2,
      { ...defaultCleaningParams(), smoothingWindow: 7 },
    );
    expect(compare?.meaningfulChange).toBe(false);
    expect(compare?.skipNote).toContain('Smoothing skipped');
  });

  it('formats compare line with coordinates and displacement', () => {
    const compare = {
      frameIndex: 5,
      rawBody: { x: 502.27, y: 263.02 },
      previewBody: { x: 497.44, y: 266.94 },
      displacementPx: 6.22,
      previewOrigin: 'smoothed' as const,
      meaningfulChange: true,
      skipNote: null,
    };
    const line = formatCleaningPreviewCompareLine(compare);
    expect(line).toContain('Raw body: (502.3, 263.0)');
    expect(line).toContain('Preview: (497.4, 266.9)');
    expect(line).toContain('Δ = 6.22 px');
    expect(line).toContain('origin: smoothed');
  });

  it('treats gap fill as meaningful when raw body was absent', () => {
    const base = [
      obs(0, 0, { x: 0, y: 0 }),
      obs(1, 33_333, null, 'lost'),
      obs(2, 66_666, { x: 20, y: 0 }),
    ];
    const preview = computeCleanedTrajectory(
      base,
      { ...defaultCleaningParams(), maxGapFrames: 1, smoothingWindow: 1 },
      800,
    );
    const compare = compareCleaningPreviewFrame(
      base,
      preview,
      [],
      1,
      defaultCleaningParams(),
    );
    expect(compare?.meaningfulChange).toBe(true);
    expect(compare?.rawBody).toBeNull();
    expect(compare?.previewBody).not.toBeNull();
  });

  it('isMeaningfulPreviewBodyChange matches displacement threshold', () => {
    expect(isMeaningfulPreviewBodyChange({ x: 0, y: 0 }, { x: 0.4, y: 0 })).toBe(false);
    expect(isMeaningfulPreviewBodyChange({ x: 0, y: 0 }, { x: 0.6, y: 0 })).toBe(true);
    expect(bodyDisplacementPx({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
