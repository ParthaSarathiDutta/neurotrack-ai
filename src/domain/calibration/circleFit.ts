import type { Point } from './connectedComponents';

export interface CircleFit {
  center: Point;
  radius: number;
  residualPx: number;
}

/** Algebraic circle fit (Kasa) to point set. */
export function fitCircle(points: Point[]): CircleFit | null {
  if (points.length < 3) return null;

  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  let sumXY = 0;
  let sumX3 = 0;
  let sumY3 = 0;
  let sumX1Y2 = 0;
  let sumX2Y1 = 0;

  for (const p of points) {
    const x = p.x;
    const y = p.y;
    const x2 = x * x;
    const y2 = y * y;
    sumX += x;
    sumY += y;
    sumX2 += x2;
    sumY2 += y2;
    sumXY += x * y;
    sumX3 += x2 * x;
    sumY3 += y2 * y;
    sumX1Y2 += x * y2;
    sumX2Y1 += x2 * y;
  }

  const C = n * sumX2 - sumX * sumX;
  const D = n * sumXY - sumX * sumY;
  const E = n * sumY2 - sumY * sumY;
  const G = 0.5 * (n * sumX3 + n * sumX1Y2 - (sumX2 + sumY2) * sumX);
  const H = 0.5 * (n * sumY3 + n * sumX2Y1 - (sumX2 + sumY2) * sumY);

  const denom = C * E - D * D;
  if (Math.abs(denom) < 1e-10) return null;

  const cx = (G * E - D * H) / denom;
  const cy = (C * H - D * G) / denom;

  let sumR = 0;
  const residuals: number[] = [];
  for (const p of points) {
    const r = Math.hypot(p.x - cx, p.y - cy);
    sumR += r;
    residuals.push(r);
  }
  const meanR = sumR / n;
  const residualPx = Math.max(...residuals.map((r) => Math.abs(r - meanR)));

  return { center: { x: cx, y: cy }, radius: meanR, residualPx };
}
