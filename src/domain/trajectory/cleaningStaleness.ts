import type { AppliedCleaning, CleaningParams, Track } from '../types';

export const STALE_REASON_MANUAL_CORRECTION =
  'Manual corrections changed — preview and re-apply cleaning.';
export const STALE_REASON_CLEANING_PARAMS =
  'Cleaning parameters changed — preview and re-apply.';
export const STALE_REASON_GEOMETRY = 'Maze geometry changed — preview and re-apply cleaning.';
export const STALE_REASON_TRIAL_WINDOW = 'Trial window changed — preview and re-apply cleaning.';
export const STALE_REASON_CALIBRATION = 'Calibration changed — preview and re-apply cleaning.';

export function cleaningParamsMatch(a: CleaningParams, b: CleaningParams): boolean {
  return (
    a.maxGapFrames === b.maxGapFrames &&
    a.maxGapDurationUs === b.maxGapDurationUs &&
    a.smoothingWindow === b.smoothingWindow &&
    a.outlierSpeedMultiplier === b.outlierSpeedMultiplier
  );
}

export function isAppliedCleaningConsumable(applied: AppliedCleaning | null | undefined): boolean {
  return Boolean(applied?.observations.length && !applied.stale);
}

/** Mark persisted applied cleaning stale without deleting the prior snapshot. */
export function markAppliedCleaningStale(track: Track, reason: string): Track {
  if (!track.appliedCleaning || track.appliedCleaning.stale) return track;
  return {
    ...track,
    appliedCleaning: {
      ...track.appliedCleaning,
      stale: true,
      staleReason: reason,
    },
  };
}
