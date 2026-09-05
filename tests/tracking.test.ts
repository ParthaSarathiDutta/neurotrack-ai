import { describe, expect, it } from 'vitest';
import { sampleBackgroundFrameIndices, buildBackgroundModel } from '../src/domain/tracking/background';
import { isPlausibleBlobSize, selectBestBlob, platformAreaPx } from '../src/domain/tracking/blobSelection';
import type { Blob } from '../src/domain/calibration/connectedComponents';
import { defaultTrackingParams } from '../src/domain/trialFactory';
import { TRACKING_MAX_BLOB_AREA_FRACTION, TRACKING_MIN_BLOB_AREA_FRACTION } from '../src/domain/constants';

describe('background sampling', () => {
  it('samples indices inside trial window only', () => {
    const index = Array.from({ length: 100 }, (_, i) => ({
      timeUs: i * 100_000,
      frameIndex: i,
      cts: i,
      timescale: 1,
    }));
    const indices = sampleBackgroundFrameIndices(index, 5_000_000, 9_000_000, 10);
    expect(indices.length).toBe(10);
    for (const idx of indices) {
      expect(index[idx].timeUs).toBeGreaterThanOrEqual(5_000_000);
      expect(index[idx].timeUs).toBeLessThanOrEqual(9_000_000);
    }
  });

  it('builds median background from two frames via medianGrayscaleFrame', () => {
    const w = 4;
    const h = 4;
    const f1 = new Uint8ClampedArray(w * h * 4).fill(0);
    const f2 = new Uint8ClampedArray(w * h * 4).fill(0);
    f1[0] = 20;
    f2[0] = 100;
    const f3 = new Uint8ClampedArray(w * h * 4).fill(0);
    f3[0] = 60;
    const bg = buildBackgroundModel([f1, f2, f3], w, h);
    expect(bg[0]).toBe(60);
  });
});

describe('blob selection', () => {
  const params = defaultTrackingParams();
  const platformRadius = 200;

  function makeBlob(area: number, x: number, y: number): Blob {
    const pixels = Array.from({ length: area }, (_, i) => ({
      x: x + (i % 10),
      y: y + Math.floor(i / 10),
    }));
    return {
      label: 0,
      area,
      centroid: { x, y },
      pixels,
      compactness: 0.5,
    };
  }

  it('rejects cylinder-sized blob', () => {
    const area = platformAreaPx(platformRadius);
    const cylinderArea = area * 0.02;
    const animalArea = area * 0.005;
    expect(isPlausibleBlobSize(makeBlob(cylinderArea, 100, 100), platformRadius, params)).toBe(
      false,
    );
    expect(isPlausibleBlobSize(makeBlob(animalArea, 100, 100), platformRadius, params)).toBe(true);
  });

  it('prefers blob near predicted position', () => {
    const area = platformAreaPx(platformRadius) * 0.005;
    const near = makeBlob(area, 120, 120);
    const far = makeBlob(area, 50, 50);
    const result = selectBestBlob([near, far], platformRadius, params, { x: 118, y: 118 });
    expect(result.blob?.centroid.x).toBe(120);
  });
});

describe('tracking constants', () => {
  it('max blob fraction excludes start cylinder scale', () => {
    expect(TRACKING_MAX_BLOB_AREA_FRACTION).toBeLessThan(0.02);
    expect(TRACKING_MIN_BLOB_AREA_FRACTION).toBeLessThan(TRACKING_MAX_BLOB_AREA_FRACTION);
  });
});
