import { describe, expect, it } from 'vitest';
import { radialApertureCenter, refineHoleCentroidsOnRadials } from '../src/domain/calibration/refineHoles';

describe('refineHoles', () => {
  it('places hole center on platform radial', () => {
    const width = 100;
    const height = 100;
    const frame = new Uint8ClampedArray(width * height * 4).fill(200);
    const platformCenter = { x: 50, y: 50 };
    const angle = Math.PI / 4;
    const r = 30;
    const hx = platformCenter.x + r * Math.cos(angle);
    const hy = platformCenter.y + r * Math.sin(angle);
    for (let dy = -3; dy <= 3; dy += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        const x = Math.round(hx + dx);
        const y = Math.round(hy + dy);
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        frame[(y * width + x) * 4] = 20;
      }
    }

    const approximate = { x: hx + 2, y: hy + 2 };
    const refined = radialApertureCenter(frame, width, height, platformCenter, approximate);
    const refinedAngle = Math.atan2(refined.y - platformCenter.y, refined.x - platformCenter.x);
    expect(refinedAngle).toBeCloseTo(angle, 2);
    expect(Math.hypot(refined.x - platformCenter.x, refined.y - platformCenter.y)).toBeCloseTo(r, 0);
  });

  it('refines a list of points on radials', () => {
    const width = 120;
    const height = 120;
    const frame = new Uint8ClampedArray(width * height * 4).fill(180);
    const platformCenter = { x: 60, y: 60 };
    const points = [{ x: 85, y: 60 }, { x: 60, y: 35 }];
    for (const p of points) {
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const x = Math.round(p.x + dx);
          const y = Math.round(p.y + dy);
          frame[(y * width + x) * 4] = 15;
        }
      }
    }
    const refined = refineHoleCentroidsOnRadials(frame, width, height, platformCenter, points);
    expect(refined).toHaveLength(2);
    for (const r of refined) {
      const angle = Math.atan2(r.y - platformCenter.y, r.x - platformCenter.x);
      const orig = points.find(
        (p) => Math.abs(Math.atan2(p.y - platformCenter.y, p.x - platformCenter.x) - angle) < 0.01,
      );
      expect(orig).toBeDefined();
    }
  });
});
