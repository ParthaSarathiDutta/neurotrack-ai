import { describe, expect, it } from 'vitest';
import { assessCalibrationQuality } from '../src/domain/calibration/calibrationQuality';
import { fitCircle } from '../src/domain/calibration/circleFit';
import { fitHoleRing } from '../src/domain/calibration/ringFit';
import { HOLE_COUNT } from '../src/domain/constants';

describe('circleFit', () => {
  it('fits a synthetic circle', () => {
    const cx = 320;
    const cy = 240;
    const r = 200;
    const points = Array.from({ length: 20 }, (_, i) => {
      const a = (i / 20) * 2 * Math.PI;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });
    const fit = fitCircle(points);
    expect(fit).not.toBeNull();
    expect(fit!.center.x).toBeCloseTo(cx, 0);
    expect(fit!.center.y).toBeCloseTo(cy, 0);
    expect(fit!.radius).toBeCloseTo(r, 0);
  });
});

describe('ringFit', () => {
  it('produces 20 holes from noisy ring candidates without center drift', () => {
    const cx = 329;
    const cy = 242;
    const r = 204;
    const candidates = Array.from({ length: 20 }, (_, i) => {
      const a = (i / 20) * 2 * Math.PI + 0.05;
      return {
        x: cx + r * Math.cos(a) + (Math.random() - 0.5) * 2,
        y: cy + r * Math.sin(a) + (Math.random() - 0.5) * 2,
      };
    });
    const ring = fitHoleRing(candidates, { x: cx, y: cy });
    expect(ring).not.toBeNull();
    expect(ring!.holes).toHaveLength(HOLE_COUNT);
    expect(ring!.detectedCount).toBeGreaterThan(10);
    expect(Math.hypot(ring!.center.x - cx, ring!.center.y - cy)).toBeLessThan(5);
    expect(ring!.residualPx).toBeLessThan(6);
  });

  it('does not shift center when refining from a good circle fit hint', () => {
    const cx = 284;
    const cy = 244;
    const r = 198;
    const candidates = Array.from({ length: 20 }, (_, i) => {
      const a = (i / 20) * 2 * Math.PI;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });
    const ring = fitHoleRing(candidates, { x: cx, y: cy });
    expect(ring!.center.x).toBeCloseTo(cx, 0);
    expect(ring!.center.y).toBeCloseTo(cy, 0);
    expect(ring!.detectedCount).toBe(20);
    expect(ring!.residualPx).toBeLessThan(1);
  });
});

describe('calibrationQuality', () => {
  it('marks tight fits as high confidence', () => {
    const ring = {
      detectedCount: 20,
      modelCount: 0,
      residualPx: 2,
      slotResidualsPx: Array(20).fill(2),
      medianSlotResidualPx: 1.5,
      rmsSlotResidualPx: 1.8,
      holes: [],
      center: { x: 0, y: 0 },
      ringRadius: 200,
      rotationDeg: 0,
    };
    const q = assessCalibrationQuality(ring, 1.5);
    expect(q.confidence).toBe('high');
  });

  it('marks poor alignment as failed', () => {
    const ring = {
      detectedCount: 14,
      modelCount: 6,
      residualPx: 20,
      slotResidualsPx: Array(20).fill(20),
      medianSlotResidualPx: 12,
      rmsSlotResidualPx: 15,
      holes: [],
      center: { x: 0, y: 0 },
      ringRadius: 200,
      rotationDeg: 0,
    };
    const q = assessCalibrationQuality(ring, 8);
    expect(q.confidence).toBe('failed');
    expect(q.reasons.length).toBeGreaterThan(0);
  });
});
