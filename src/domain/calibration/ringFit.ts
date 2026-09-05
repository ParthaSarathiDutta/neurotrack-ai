import { HOLE_COUNT, HOLE_SPACING_DEG } from '../constants';
import type { Hole } from '../types';
import type { Point } from './connectedComponents';
import { fitCircle } from './circleFit';

export interface RingFitResult {
  center: Point;
  ringRadius: number;
  rotationDeg: number;
  holes: Hole[];
  detectedCount: number;
  modelCount: number;
  /** Max slot-alignment residual among detected holes (legacy name). */
  residualPx: number;
  /** Per-hole distance from assigned position to uniform 18° slot (px). */
  slotResidualsPx: number[];
  medianSlotResidualPx: number;
  rmsSlotResidualPx: number;
}

const DEG = Math.PI / 180;
const SLOT_MATCH_TOLERANCE = 0.1; // fraction of ring radius

/** Fit 20-hole ring with uniform 18° spacing to candidate centroids. */
export function fitHoleRing(
  candidates: Point[],
  centerHint?: Point,
): RingFitResult | null {
  if (candidates.length < 3) return null;

  const initial = fitCircle(candidates);
  if (!initial && !centerHint) return null;

  let cx = initial?.center.x ?? centerHint!.x;
  let cy = initial?.center.y ?? centerHint!.y;
  let ringRadius =
    initial?.radius ??
    candidates.reduce((sum, c) => sum + Math.hypot(c.x - cx, c.y - cy), 0) / candidates.length;

  let bestRotation = searchBestRotationDeg(candidates, cx, cy, ringRadius);

  // Refine center/radius/rotation with geometric circle fits — never average centroids.
  for (let iter = 0; iter < 4; iter += 1) {
    const matches = matchCandidatesToRing(candidates, cx, cy, ringRadius, bestRotation);
    const inliers = matches.filter((m) => m.dist < ringRadius * SLOT_MATCH_TOLERANCE);
    if (inliers.length >= 6) {
      const refined = fitCircle(inliers.map((m) => m.candidate));
      if (refined) {
        cx = refined.center.x;
        cy = refined.center.y;
        ringRadius = refined.radius;
      }
    }
    bestRotation = searchBestRotationDeg(candidates, cx, cy, ringRadius);
  }

  return buildRingResult(candidates, cx, cy, ringRadius, bestRotation);
}

function searchBestRotationDeg(
  candidates: Point[],
  cx: number,
  cy: number,
  radius: number,
): number {
  let bestRotation = 0;
  let bestScore = Infinity;

  for (let deg = 0; deg < 360; deg += 0.5) {
    const score = scoreRotation(candidates, cx, cy, radius, deg * DEG);
    if (score < bestScore) {
      bestScore = score;
      bestRotation = deg;
    }
  }

  for (let deg = bestRotation - 1; deg <= bestRotation + 1; deg += 0.05) {
    const normalized = ((deg % 360) + 360) % 360;
    const score = scoreRotation(candidates, cx, cy, radius, normalized * DEG);
    if (score < bestScore) {
      bestScore = score;
      bestRotation = normalized;
    }
  }

  return bestRotation;
}

function buildRingResult(
  candidates: Point[],
  cx: number,
  cy: number,
  ringRadius: number,
  rotationDeg: number,
): RingFitResult {
  const matchMap = new Map<number, { candidate: Point; dist: number }>();
  for (const m of matchCandidatesToRing(candidates, cx, cy, ringRadius, rotationDeg)) {
    matchMap.set(m.holeId, { candidate: m.candidate, dist: m.dist });
  }

  const matchTolerance = ringRadius * SLOT_MATCH_TOLERANCE;
  const holes: Hole[] = [];
  const slotResidualsPx = new Array<number>(HOLE_COUNT).fill(Infinity);
  let detectedCount = 0;
  let modelCount = 0;
  let maxResidual = 0;
  const detectedResiduals: number[] = [];

  for (let i = 0; i < HOLE_COUNT; i += 1) {
    const angle = (rotationDeg + i * HOLE_SPACING_DEG) * DEG;
    const modelX = cx + ringRadius * Math.cos(angle);
    const modelY = cy + ringRadius * Math.sin(angle);
    const match = matchMap.get(i);

    if (match && match.dist < matchTolerance) {
      holes.push({
        id: i,
        x: match.candidate.x,
        y: match.candidate.y,
        source: 'detected',
        confidence: 1 - match.dist / matchTolerance,
      });
      slotResidualsPx[i] = match.dist;
      detectedCount += 1;
      maxResidual = Math.max(maxResidual, match.dist);
      detectedResiduals.push(match.dist);
    } else {
      holes.push({
        id: i,
        x: modelX,
        y: modelY,
        source: 'model',
        confidence: null,
      });
      slotResidualsPx[i] = match?.dist ?? Infinity;
      modelCount += 1;
    }
  }

  const medianSlot =
    detectedResiduals.length > 0
      ? median(detectedResiduals)
      : median(slotResidualsPx.filter(Number.isFinite));
  const rmsSlot = rms(detectedResiduals.length > 0 ? detectedResiduals : []);

  return {
    center: { x: cx, y: cy },
    ringRadius,
    rotationDeg,
    holes,
    detectedCount,
    modelCount,
    residualPx: maxResidual,
    slotResidualsPx,
    medianSlotResidualPx: medianSlot,
    rmsSlotResidualPx: rmsSlot,
  };
}

function scoreRotation(
  candidates: Point[],
  cx: number,
  cy: number,
  radius: number,
  rotationRad: number,
): number {
  let score = 0;
  for (const c of candidates) {
    const angle = Math.atan2(c.y - cy, c.x - cx);
    const rel = angle - rotationRad;
    const slot = Math.round(rel / (HOLE_SPACING_DEG * DEG));
    const expected = rotationRad + slot * HOLE_SPACING_DEG * DEG;
    const ex = cx + radius * Math.cos(expected);
    const ey = cy + radius * Math.sin(expected);
    score += Math.hypot(c.x - ex, c.y - ey);
  }
  return score;
}

function matchCandidatesToRing(
  candidates: Point[],
  cx: number,
  cy: number,
  radius: number,
  rotationDeg: number,
): Array<{ holeId: number; candidate: Point; dist: number }> {
  const rotationRad = rotationDeg * DEG;
  const slots: Array<{ holeId: number; candidate: Point; dist: number } | null> =
    new Array(HOLE_COUNT).fill(null);

  for (const c of candidates) {
    const angle = Math.atan2(c.y - cy, c.x - cx);
    let rel = angle - rotationRad;
    while (rel < 0) rel += 2 * Math.PI;
    while (rel >= 2 * Math.PI) rel -= 2 * Math.PI;
    const slot = Math.round(rel / (HOLE_SPACING_DEG * DEG)) % HOLE_COUNT;
    const expectedAngle = (rotationDeg + slot * HOLE_SPACING_DEG) * DEG;
    const ex = cx + radius * Math.cos(expectedAngle);
    const ey = cy + radius * Math.sin(expectedAngle);
    const dist = Math.hypot(c.x - ex, c.y - ey);

    const existing = slots[slot];
    if (!existing || dist < existing.dist) {
      slots[slot] = { holeId: slot, candidate: c, dist };
    }
  }

  return slots.filter((s): s is NonNullable<typeof s> => s !== null);
}

function median(values: number[]): number {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function rms(values: number[]): number {
  if (values.length === 0) return Infinity;
  return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
}

/** Generate 20 holes from center, ring radius, and one anchor hole click. */
export function holesFromAnchor(
  center: Point,
  ringRadius: number,
  anchorHole: Point,
): RingFitResult {
  const anchorAngle = Math.atan2(anchorHole.y - center.y, anchorHole.x - center.x);
  const rotationDeg = (anchorAngle * 180) / Math.PI;
  const holes: Hole[] = [];

  for (let i = 0; i < HOLE_COUNT; i += 1) {
    const angle = (rotationDeg + i * HOLE_SPACING_DEG) * DEG;
    holes.push({
      id: i,
      x: center.x + ringRadius * Math.cos(angle),
      y: center.y + ringRadius * Math.sin(angle),
      source: i === 0 ? 'manual' : 'model',
      confidence: null,
    });
  }

  let closestId = 0;
  let closestDist = Infinity;
  for (const h of holes) {
    const d = Math.hypot(h.x - anchorHole.x, h.y - anchorHole.y);
    if (d < closestDist) {
      closestDist = d;
      closestId = h.id;
    }
  }

  const rotated = holes.map((h, idx) => ({
    ...h,
    id: (idx - closestId + HOLE_COUNT) % HOLE_COUNT,
    source: idx === closestId ? ('manual' as const) : h.source,
  }));

  const sorted = rotated.sort((a, b) => a.id - b.id);

  return {
    center,
    ringRadius,
    rotationDeg,
    holes: sorted,
    detectedCount: 0,
    modelCount: HOLE_COUNT,
    residualPx: 0,
    slotResidualsPx: new Array(HOLE_COUNT).fill(0),
    medianSlotResidualPx: 0,
    rmsSlotResidualPx: 0,
  };
}

/** Recompute slot-alignment residuals after hole positions are refined post-fit. */
export function recomputeSlotResiduals(ring: RingFitResult): RingFitResult {
  const slotResidualsPx = new Array<number>(HOLE_COUNT).fill(Infinity);
  let maxResidual = 0;
  const detectedResiduals: number[] = [];

  for (const hole of ring.holes) {
    const angle = (ring.rotationDeg + hole.id * HOLE_SPACING_DEG) * DEG;
    const ex = ring.center.x + ring.ringRadius * Math.cos(angle);
    const ey = ring.center.y + ring.ringRadius * Math.sin(angle);
    const dist = Math.hypot(hole.x - ex, hole.y - ey);
    slotResidualsPx[hole.id] = dist;
    if (hole.source === 'detected') {
      maxResidual = Math.max(maxResidual, dist);
      detectedResiduals.push(dist);
    }
  }

  return {
    ...ring,
    residualPx: maxResidual,
    slotResidualsPx,
    medianSlotResidualPx: median(detectedResiduals.length ? detectedResiduals : []),
    rmsSlotResidualPx: rms(detectedResiduals.length ? detectedResiduals : []),
  };
}
