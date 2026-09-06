import {
  TRACKING_DISAPPEARANCE_LOOKBACK,
  TRACKING_DISAPPEARANCE_SHRINK_RATIO,
  TRACKING_HOLE_PROXIMITY_FRACTION,
} from '../constants';
import type { Point } from '../calibration/connectedComponents';
import type { Geometry, Hole, ObservedStatus, ObservationQualityFlag } from '../types';

export interface DisappearanceContext {
  lastPosition: Point | null;
  recentAreas: number[];
  recentCentroids: Point[];
}

/** Nearest hole to `point`, only if within the hole-proximity catch radius. */
export function nearestHole(point: Point, holes: Hole[], platformRadiusPx: number): Hole | null {
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

/** Shrinking blob area OR slowing motion across the lookback window — light evidence
 *  of a genuine disappearance (D7), not merely a lost blob mid-platform. */
function showedDisappearanceEvidence(recentAreas: number[], recentCentroids: Point[]): boolean {
  let shrink = false;
  if (recentAreas.length >= TRACKING_DISAPPEARANCE_LOOKBACK) {
    const areas = recentAreas.slice(-TRACKING_DISAPPEARANCE_LOOKBACK);
    shrink = areas[areas.length - 1] < areas[0] * TRACKING_DISAPPEARANCE_SHRINK_RATIO;
  }

  let slowing = false;
  if (recentCentroids.length >= TRACKING_DISAPPEARANCE_LOOKBACK + 1) {
    const pts = recentCentroids.slice(-(TRACKING_DISAPPEARANCE_LOOKBACK + 1));
    const speeds: number[] = [];
    for (let i = 1; i < pts.length; i += 1) {
      speeds.push(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    const first = speeds[0];
    const last = speeds[speeds.length - 1];
    slowing = first > 2 && last < first * TRACKING_DISAPPEARANCE_SHRINK_RATIO;
  }

  return shrink || slowing;
}

/**
 * Provisional per-frame status when no blob is found — NOT a scientific escape claim (MS-5).
 *
 * Only a *confirmed* target hole counts as "known" here — an unconfirmed/proposed value
 * is a suggestion, not a scientist-verified fact, and must not silently drive scientific
 * classification. Proximity to a non-target hole is never sufficient grounds for
 * `absent_in_hole` per the task reference (non-target holes are known dead ends): the
 * disappearance must be near an actual hole opening, not merely "somewhere on the rim."
 */
export function classifyMissingObservation(
  geometry: Geometry,
  ctx: DisappearanceContext,
): { observed: ObservedStatus; flags: ObservationQualityFlag[] } {
  const radius = geometry.platformRadiusPx;
  if (!radius || !ctx.lastPosition) {
    return { observed: 'lost', flags: [] };
  }

  if (!showedDisappearanceEvidence(ctx.recentAreas, ctx.recentCentroids)) {
    return { observed: 'lost', flags: [] };
  }

  const nearestAnyHole = nearestHole(ctx.lastPosition, geometry.holes, radius);
  if (!nearestAnyHole) {
    // Disappearing away from any actual hole opening is far more likely a tracking
    // failure (occlusion, shadow, rig hardware) than a genuine hole entry.
    return { observed: 'lost', flags: [] };
  }

  const confirmedTargetId = geometry.targetHoleConfirmedAt ? geometry.targetHoleId : null;
  if (confirmedTargetId != null && nearestAnyHole.id !== confirmedTargetId) {
    return { observed: 'lost', flags: [] };
  }

  // Either near the confirmed target hole, or the target is still unknown and this is
  // near *some* real hole opening — both are provisional hypotheses only (MS-5 decides).
  return { observed: 'absent_in_hole', flags: ['near_hole_disappearance'] };
}
