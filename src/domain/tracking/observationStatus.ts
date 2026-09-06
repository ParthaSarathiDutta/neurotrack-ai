import {
  TRACKING_ABSENT_IN_HOLE_MIN_MISSING_FRAMES,
  TRACKING_ABSENT_IN_HOLE_PEAK_SHRINK_RATIO,
  TRACKING_DISAPPEARANCE_LOOKBACK,
  TRACKING_DISAPPEARANCE_SHRINK_RATIO,
  TRACKING_HOLE_INTERACTION_MIN_FRAMES,
  TRACKING_HOLE_PROXIMITY_FRACTION,
} from '../constants';
import type { Point } from '../calibration/connectedComponents';
import type { Geometry, Hole, ObservedStatus, ObservationQualityFlag } from '../types';

export interface DisappearanceContext {
  lastPosition: Point | null;
  recentAreas: number[];
  recentCentroids: Point[];
}

/** Temporal gate carried across consecutive missing frames — prevents a single missed
 * detection (or partial rim shrink while the animal is still visible) from becoming
 * an unsupported biological claim. */
export interface DisappearanceTemporalState {
  consecutiveMissingFrames: number;
  peakRecentArea: number;
  holeProximityStreak: number;
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

/** Shrinking blob area OR slowing motion across the lookback window. */
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

/** The last tracked area must have collapsed to a small remnant relative to the recent
 * peak — partial rim occlusion still leaves a substantial visible blob. */
function lastTrackedAreaCollapsed(recentAreas: number[], peakRecentArea: number): boolean {
  if (recentAreas.length === 0 || peakRecentArea <= 0) return false;
  const lastArea = recentAreas[recentAreas.length - 1];
  return lastArea <= peakRecentArea * TRACKING_ABSENT_IN_HOLE_PEAK_SHRINK_RATIO;
}

/**
 * Provisional per-frame status when no blob is found — NOT a scientific escape claim (MS-5).
 *
 * Requires a short temporal sequence: credible hole interaction while still tracked,
 * then sustained missing frames after the blob shrank to a small remnant. A single missed
 * frame or partial shrink while the animal may still be visible must stay `lost`.
 */
export function classifyMissingObservation(
  geometry: Geometry,
  ctx: DisappearanceContext,
  temporal: DisappearanceTemporalState,
): { observed: ObservedStatus; flags: ObservationQualityFlag[] } {
  const radius = geometry.platformRadiusPx;
  if (!radius || !ctx.lastPosition) {
    return { observed: 'lost', flags: [] };
  }

  if (temporal.consecutiveMissingFrames < TRACKING_ABSENT_IN_HOLE_MIN_MISSING_FRAMES) {
    return { observed: 'lost', flags: [] };
  }

  if (temporal.holeProximityStreak < TRACKING_HOLE_INTERACTION_MIN_FRAMES) {
    return { observed: 'lost', flags: [] };
  }

  if (!showedDisappearanceEvidence(ctx.recentAreas, ctx.recentCentroids)) {
    return { observed: 'lost', flags: [] };
  }

  if (!lastTrackedAreaCollapsed(ctx.recentAreas, temporal.peakRecentArea)) {
    return { observed: 'lost', flags: [] };
  }

  const nearestAnyHole = nearestHole(ctx.lastPosition, geometry.holes, radius);
  if (!nearestAnyHole) {
    return { observed: 'lost', flags: [] };
  }

  const confirmedTargetId = geometry.targetHoleConfirmedAt ? geometry.targetHoleId : null;
  if (confirmedTargetId != null && nearestAnyHole.id !== confirmedTargetId) {
    return { observed: 'lost', flags: [] };
  }

  return { observed: 'absent_in_hole', flags: ['near_hole_disappearance'] };
}
