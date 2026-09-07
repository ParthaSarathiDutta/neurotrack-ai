import type { ObservationQualityFlag } from '../types';

const CLEANING_FLAG_LABELS: Partial<Record<ObservationQualityFlag, string>> = {
  gap_interpolated: 'gap-filled estimate',
  speed_outlier_replaced: 'speed outlier replaced',
  duplicate_pts_spatial_estimate: 'duplicate-PTS spatial estimate',
  low_confidence: 'low confidence',
  possible_occlusion: 'possible occlusion',
  speed_outlier: 'speed outlier',
  ambiguous_head_tail: 'ambiguous head/tail',
  near_hole_disappearance: 'near-hole disappearance',
};

export function formatCleaningQualityFlags(flags: ObservationQualityFlag[]): string {
  return flags.map((f) => CLEANING_FLAG_LABELS[f] ?? f).join(', ');
}
