import {
  TRACKING_DISAPPEARANCE_LOOKBACK,
  TRACKING_HOLE_PROXIMITY_FRACTION,
  TRACKING_RIM_BAND_FRACTION,
} from '../constants';
import type { Point } from '../calibration/connectedComponents';
import type { Geometry, Hole, ObservedStatus, ObservationQualityFlag } from '../types';

export interface DisappearanceContext {
  lastPosition: Point | null;
  recentAreas: number[];
  recentCentroids: Point[];
}

export function isNearPlatformRim(
  point: Point,
  center: Point,
  platformRadiusPx: number,
): boolean {
  const dist = Math.hypot(point.x - center.x, point.y - center.y);
  return dist >= platformRadiusPx * TRACKING_RIM_BAND_FRACTION;
}

export function nearestHole(
  point: Point,
  holes: Hole[],
  platformRadiusPx: number,
): Hole | null {
  if (holes.length === 0) return null;
  const maxDist = platformRadiusPx * TRACKING_HOLE_PROXIMITY_FRACTION;
  let best: Hole | null = null;
  let bestDist = Infinity;
  for (const h of holes) {
    const d = Math.hypot(point.x - h.x, point.y - h.y);
    if (d < bestDist) {
      bestDist = d;
      best = h;
    }
  }
  return bestDist <= maxDist ? best : null;
}

function isNearTargetHole(
  point: Point,
  geometry: Geometry,
  platformRadiusPx: number,
): boolean {
  const targetId = geometry.targetHoleId ?? geometry.proposedTargetHoleId;
  if (targetId == null) {
    return isNearPlatformRim(point, geometry.platformCenter!, platformRadiusPx);
  }
  const hole = geometry.holes.find((h) => h.id === targetId);
  if (!hole) return false;
  const maxDist = platformRadiusPx * TRACKING_HOLE_PROXIMITY_FRACTION;
  return Math.hypot(point.x - hole.x, point.y - hole.y) <= maxDist;
}

function showedShrinkOrSlowPattern(recentAreas: number[]): boolean {
  if (recentAreas.length < 2) return false;
  const lookback = recentAreas.slice(-TRACKING_DISAPPEARANCE_LOOKBACK);
  if (lookback.length < 2) return false;
  const first = lookback[0];
  const last = lookback[lookback.length - 1];
  return last < first * 0.85;
}

/**
 * Provisional per-frame status when no blob is found — NOT a scientific escape claim (MS-5).
 */
export function classifyMissingObservation(
  geometry: Geometry,
  ctx: DisappearanceContext,
): { observed: ObservedStatus; flags: ObservationQualityFlag[] } {
  const flags: ObservationQualityFlag[] = ['near_hole_disappearance'];
  const center = geometry.platformCenter;
  const radius = geometry.platformRadiusPx;
  if (!center || !radius || !ctx.lastPosition) {
    return { observed: 'lost', flags: [] };
  }

  const nearTarget = isNearTargetHole(ctx.lastPosition, geometry, radius);
  const shrinkPattern = showedShrinkOrSlowPattern(ctx.recentAreas);

  if (nearTarget && shrinkPattern) {
    return { observed: 'absent_in_hole', flags };
  }

  if (isNearPlatformRim(ctx.lastPosition, center, radius) && shrinkPattern) {
    return { observed: 'absent_in_hole', flags };
  }

  return { observed: 'lost', flags: [] };
}
