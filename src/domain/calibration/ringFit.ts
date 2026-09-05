import { HOLE_COUNT, HOLE_SPACING_DEG } from '../constants';
import type { Hole } from '../types';
import type { Point } from './connectedComponents';

export interface RingFitResult {
  center: Point;
  ringRadius: number;
  rotationDeg: number;
  holes: Hole[];
  detectedCount: number;
  modelCount: number;
  residualPx: number;
}

const DEG = Math.PI / 180;

/** Fit 20-hole ring with uniform 18° spacing to candidate centroids. */
export function fitHoleRing(
  candidates: Point[],
  centerHint?: Point,
): RingFitResult | null {
  if (candidates.length < 3) return null;

  // Initial center from candidate mean if no hint
  let cx = centerHint?.x ?? 0;
  let cy = centerHint?.y ?? 0;
  if (!centerHint) {
    for (const c of candidates) {
      cx += c.x;
      cy += c.y;
    }
    cx /= candidates.length;
    cy /= candidates.length;
  }

  // Mean radius from candidates
  const radii = candidates.map((c) => Math.hypot(c.x - cx, c.y - cy));
  let ringRadius = radii.reduce((a, b) => a + b, 0) / radii.length;

  // Find best rotation offset by trying all candidate angles as phase anchors
  let bestRotation = 0;
  let bestScore = Infinity;

  for (const c of candidates) {
    const baseAngle = Math.atan2(c.y - cy, c.x - cx);
    for (let offset = 0; offset < HOLE_COUNT; offset += 1) {
      const rotation = baseAngle - offset * HOLE_SPACING_DEG * DEG;
      const score = scoreRotation(candidates, cx, cy, ringRadius, rotation);
      if (score < bestScore) {
        bestScore = score;
        bestRotation = (rotation * 180) / Math.PI;
        bestRotation = ((bestRotation % 360) + 360) % 360;
      }
    }
  }

  // Refine center and radius with matched candidates
  const matched = matchCandidatesToRing(candidates, cx, cy, ringRadius, bestRotation);
  if (matched.length >= 3) {
    let sumX = 0;
    let sumY = 0;
    let sumR = 0;
    for (const m of matched) {
      sumX += m.candidate.x;
      sumY += m.candidate.y;
      sumR += Math.hypot(m.candidate.x - cx, m.candidate.y - cy);
    }
    cx = sumX / matched.length;
    cy = sumY / matched.length;
    ringRadius = sumR / matched.length;
  }

  const holes: Hole[] = [];
  let detectedCount = 0;
  let modelCount = 0;
  let maxResidual = 0;

  const matchMap = new Map<number, { candidate: Point; dist: number }>();
  for (const m of matchCandidatesToRing(candidates, cx, cy, ringRadius, bestRotation)) {
    matchMap.set(m.holeId, { candidate: m.candidate, dist: m.dist });
  }

  for (let i = 0; i < HOLE_COUNT; i += 1) {
    const angle = (bestRotation + i * HOLE_SPACING_DEG) * DEG;
    const modelX = cx + ringRadius * Math.cos(angle);
    const modelY = cy + ringRadius * Math.sin(angle);
    const match = matchMap.get(i);

    if (match && match.dist < ringRadius * 0.12) {
      holes.push({
        id: i,
        x: match.candidate.x,
        y: match.candidate.y,
        source: 'detected',
        confidence: 1 - match.dist / (ringRadius * 0.12),
      });
      detectedCount += 1;
      maxResidual = Math.max(maxResidual, match.dist);
    } else {
      holes.push({
        id: i,
        x: modelX,
        y: modelY,
        source: 'model',
        confidence: null,
      });
      modelCount += 1;
    }
  }

  return {
    center: { x: cx, y: cy },
    ringRadius,
    rotationDeg: bestRotation,
    holes,
    detectedCount,
    modelCount,
    residualPx: maxResidual,
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
    const expectedR = radius;
    const ex = cx + expectedR * Math.cos(expected);
    const ey = cy + expectedR * Math.sin(expected);
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

  // Find which hole is closest to anchor and renumber rotation
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

  return {
    center,
    ringRadius,
    rotationDeg,
    holes: rotated.sort((a, b) => a.id - b.id),
    detectedCount: 0,
    modelCount: HOLE_COUNT,
    residualPx: 0,
  };
}
