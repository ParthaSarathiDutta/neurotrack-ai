import type { Point } from '../calibration/connectedComponents';
import { TRACKING_RIM_BAND_FRACTION } from '../constants';
import type { Geometry } from '../types';
import { nearestHole } from './observationStatus';

export function platformDistance(point: Point, center: Point): number {
  return Math.hypot(point.x - center.x, point.y - center.y);
}

/** True when the point lies in the outer rim band of the platform (partial occlusion zone). */
export function isNearPlatformRim(
  point: Point,
  center: Point,
  platformRadiusPx: number,
): boolean {
  if (platformRadiusPx <= 0) return false;
  return platformDistance(point, center) / platformRadiusPx >= TRACKING_RIM_BAND_FRACTION;
}

/** True when tracked near an actual hole opening (not merely "somewhere on the rim"). */
export function isNearHoleOpening(
  point: Point,
  geometry: Geometry,
): boolean {
  const radius = geometry.platformRadiusPx;
  if (!radius) return false;
  return nearestHole(point, geometry.holes, radius) != null;
}

export function isRimOrHoleContext(
  point: Point | null,
  geometry: Geometry,
): boolean {
  if (!point || !geometry.platformCenter || !geometry.platformRadiusPx) return false;
  return (
    isNearPlatformRim(point, geometry.platformCenter, geometry.platformRadiusPx) ||
    isNearHoleOpening(point, geometry)
  );
}
