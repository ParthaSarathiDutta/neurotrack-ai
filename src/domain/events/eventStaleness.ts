import type { EventAnalysis } from '../types';

export const STALE_REASON_BASIS = 'Measurement basis changed — re-detect events.';
export const STALE_REASON_TRAJECTORY = 'Trajectory changed — re-detect events.';
export const STALE_REASON_GEOMETRY = 'Geometry changed — re-detect events.';
export const STALE_REASON_WINDOW = 'Trial window changed — re-detect events.';
export const STALE_REASON_PARAMS = 'Event parameters changed — re-detect events.';

export function markEventAnalysisStale(analysis: EventAnalysis | null, reason: string): EventAnalysis | null {
  if (!analysis) return null;
  if (analysis.stale) return analysis;
  return { ...analysis, stale: true, staleReason: reason };
}
