import { describe, expect, it } from 'vitest';
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
  it('produces 20 holes from noisy ring candidates', () => {
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
  });
});
