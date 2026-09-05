import type { Point } from './connectedComponents';

function sampleGrayBilinear(
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  if (x0 < 0 || y0 < 0 || x1 >= width || y1 >= height) {
    const xi = Math.max(0, Math.min(width - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(height - 1, Math.round(y)));
    return frame[(yi * width + xi) * 4];
  }
  const fx = x - x0;
  const fy = y - y0;
  const g = (xi: number, yi: number) => frame[(yi * width + xi) * 4];
  const top = g(x0, y0) * (1 - fx) + g(x1, y0) * fx;
  const bot = g(x0, y1) * (1 - fx) + g(x1, y1) * fx;
  return top * (1 - fy) + bot * fy;
}

/**
 * Hole opening center on the platform radial through an approximate position.
 * Scans along the radial line and locates the intensity minimum band, which is
 * robust to tangential shadow smear from uneven platform lighting.
 */
export function radialApertureCenter(
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  platformCenter: Point,
  approximate: Point,
  scanHalfWidthPx = 16,
): Point {
  const angle = Math.atan2(approximate.y - platformCenter.y, approximate.x - platformCenter.x);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rApprox = Math.hypot(approximate.x - platformCenter.x, approximate.y - platformCenter.y);

  const samples: { dr: number; gray: number }[] = [];
  for (let dr = -scanHalfWidthPx; dr <= scanHalfWidthPx; dr += 0.25) {
    const r = rApprox + dr;
    const x = platformCenter.x + r * cos;
    const y = platformCenter.y + r * sin;
    samples.push({ dr, gray: sampleGrayBilinear(frame, width, height, x, y) });
  }
  if (samples.length === 0) return approximate;

  const minGray = Math.min(...samples.map((s) => s.gray));
  const darkThreshold = minGray + 20;

  let sumDr = 0;
  let sumW = 0;
  for (const s of samples) {
    if (s.gray <= darkThreshold) {
      const w = (darkThreshold - s.gray + 1) ** 2;
      sumDr += s.dr * w;
      sumW += w;
    }
  }

  if (sumW <= 0) return approximate;
  const r = rApprox + sumDr / sumW;
  return { x: platformCenter.x + r * cos, y: platformCenter.y + r * sin };
}

/** Refine candidate hole positions onto platform radials using radial dark-aperture centers. */
export function refineHoleCentroidsOnRadials(
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  platformCenter: Point,
  points: Point[],
  scanHalfWidthPx = 16,
): Point[] {
  return points.map((p) =>
    radialApertureCenter(frame, width, height, platformCenter, p, scanHalfWidthPx),
  );
}

/** @deprecated Use refineHoleCentroidsOnRadials — window centroid smears tangentially under lighting gradients. */
export function refineDetectedHoleCentroids(
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  points: Point[],
  platformCenter: Point,
  searchRadiusPx = 10,
): Point[] {
  return refineHoleCentroidsOnRadials(frame, width, height, platformCenter, points, searchRadiusPx);
}

export function darkCentroidInWindow(
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  center: Point,
  searchRadiusPx: number,
): Point {
  let sumX = 0;
  let sumY = 0;
  let sumW = 0;
  const cx = Math.round(center.x);
  const cy = Math.round(center.y);

  for (let dy = -searchRadiusPx; dy <= searchRadiusPx; dy += 1) {
    for (let dx = -searchRadiusPx; dx <= searchRadiusPx; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const dist = Math.hypot(dx, dy);
      if (dist > searchRadiusPx) continue;
      const gray = frame[(y * width + x) * 4];
      const weight = (255 - gray) * (1 - dist / (searchRadiusPx + 1));
      if (weight <= 0) continue;
      sumX += x * weight;
      sumY += y * weight;
      sumW += weight;
    }
  }

  if (sumW <= 0) return center;
  return { x: sumX / sumW, y: sumY / sumW };
}
