import type { Observation, ObservationQualityFlag } from '../types';

export const CLEANING_ESTIMATE_FLAGS: ObservationQualityFlag[] = [
  'gap_interpolated',
  'speed_outlier_replaced',
  'duplicate_pts_spatial_estimate',
];

/** True when bodyXY is a cleaning estimate rather than a directly observed/auto-tracked point. */
export function isEstimatedBodyPosition(obs: Observation | null | undefined): boolean {
  if (!obs?.bodyXY) return false;
  if (obs.origin === 'interpolated' || obs.origin === 'smoothed') return true;
  return obs.qualityFlags?.some((f) => CLEANING_ESTIMATE_FLAGS.includes(f)) ?? false;
}
