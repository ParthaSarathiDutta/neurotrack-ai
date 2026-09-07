import type { Geometry, Hole, Observation } from '../types';

export interface Point {
  x: number;
  y: number;
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function nearestHoleWithin(
  point: Point,
  holes: Hole[],
  platformRadiusPx: number,
  proximityFraction: number,
): { hole: Hole; distance: number } | null {
  if (holes.length === 0 || platformRadiusPx <= 0) return null;
  const maxDist = platformRadiusPx * proximityFraction;
  let best: Hole | null = null;
  let bestDist = Infinity;
  for (const h of holes) {
    const d = dist(point, h);
    if (d < bestDist) {
      bestDist = d;
      best = h;
    }
  }
  if (!best || bestDist > maxDist) return null;
  return { hole: best, distance: bestDist };
}

export function holeAngleDeg(hole: Hole, center: Point): number {
  const rad = Math.atan2(hole.y - center.y, hole.x - center.x);
  let deg = (rad * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

export function bodyAngleFromCenter(body: Point, center: Point): number {
  return holeAngleDeg({ id: -1, x: body.x, y: body.y, source: 'detected', confidence: null }, center);
}

export function isInTargetQuadrantTargetCentered(
  body: Point,
  center: Point,
  targetHole: Hole,
): boolean {
  const targetAngle = holeAngleDeg(targetHole, center);
  const bodyAngle = bodyAngleFromCenter(body, center);
  let delta = Math.abs(bodyAngle - targetAngle);
  if (delta > 180) delta = 360 - delta;
  return delta <= 45;
}

export function isInTargetQuadrantFixedOrientation(
  body: Point,
  center: Point,
  targetHole: Hole,
  northDeg: number,
): boolean {
  const targetAngle = holeAngleDeg(targetHole, center);
  const quadrantStart = (targetAngle - 45 - northDeg + 360) % 360;
  const bodyAngle = (bodyAngleFromCenter(body, center) - northDeg + 360) % 360;
  const relTarget = (targetAngle - northDeg + 360) % 360;
  const quadrantCenter = relTarget;
  let delta = Math.abs(bodyAngle - quadrantCenter);
  if (delta > 180) delta = 360 - delta;
  return delta <= 45 && quadrantStart >= 0;
}

export function observationProximityToHole(
  obs: Observation,
  hole: Hole,
  platformRadiusPx: number,
  noseFraction: number,
  bodyFraction: number,
): { inZone: boolean; basis: 'nose' | 'body' | null; distance: number | null } {
  if (obs.noseXY) {
    const d = dist(obs.noseXY, hole);
    return {
      inZone: d <= platformRadiusPx * noseFraction,
      basis: 'nose',
      distance: d,
    };
  }
  if (obs.bodyXY) {
    const d = dist(obs.bodyXY, hole);
    return {
      inZone: d <= platformRadiusPx * bodyFraction,
      basis: 'body',
      distance: d,
    };
  }
  return { inZone: false, basis: null, distance: null };
}

export function effectiveTrialStartUs(
  window: { startTimeUs: number | null; proposedStartTimeUs: number | null },
): number | null {
  return window.startTimeUs ?? window.proposedStartTimeUs;
}

export function censorBoundaryTimeUs(
  window: {
    startTimeUs: number | null;
    proposedStartTimeUs: number | null;
    endTimeUs: number | null;
    proposedEndTimeUs: number | null;
    cutoffSeconds: number | null;
  },
  timestampIndex: { timeUs: number }[],
): number | null {
  const start = effectiveTrialStartUs(window);
  if (start == null || timestampIndex.length === 0) return null;
  const recordingEnd = timestampIndex[timestampIndex.length - 1]!.timeUs;
  const windowEnd = window.endTimeUs ?? window.proposedEndTimeUs ?? recordingEnd;
  let boundary = Math.min(recordingEnd, windowEnd);
  if (window.cutoffSeconds != null && window.cutoffSeconds > 0) {
    boundary = Math.min(boundary, start + window.cutoffSeconds * 1_000_000);
  }
  return boundary;
}

/** Last presentation-order frame at or before the effective analysis boundary. */
export function censorBoundaryFrameIndex(
  window: Parameters<typeof censorBoundaryTimeUs>[0],
  timestampIndex: { timeUs: number; frameIndex: number }[],
): number | null {
  const censorUs = censorBoundaryTimeUs(window, timestampIndex);
  if (censorUs == null || timestampIndex.length === 0) return null;
  let best: { timeUs: number; frameIndex: number } | null = null;
  for (const entry of timestampIndex) {
    if (entry.timeUs <= censorUs) best = entry;
    else break;
  }
  return best?.frameIndex ?? null;
}

/** Presentation-order frames from entry onset through the analysis boundary (inclusive). */
export function entryToCensorFrameIndices(
  timestampIndex: { timeUs: number; frameIndex: number }[],
  entryFrameIndex: number,
  censorUs: number,
  censorFrameIndex: number,
): number[] {
  return timestampIndex
    .filter(
      (e) =>
        e.frameIndex >= entryFrameIndex &&
        e.frameIndex <= censorFrameIndex &&
        e.timeUs <= censorUs,
    )
    .map((e) => e.frameIndex);
}

export function isInTrial(obs: Observation, trialStartUs: number, censorUs: number): boolean {
  return obs.timeUs >= trialStartUs && obs.timeUs <= censorUs && obs.observed !== 'absent_pre_trial';
}

export function confirmedTargetHoleId(geometry: Geometry): number | null {
  return geometry.targetHoleConfirmedAt ? geometry.targetHoleId : null;
}
