import type { TrialRecord } from '../domain/types';

/** Trial has completed analysis that can be viewed/exported without local video bytes. */
export function hasStoredAnalysis(trial: TrialRecord): boolean {
  return trial.track?.status === 'done' && trial.measures != null;
}

export function canShowVideoReview(trial: TrialRecord): boolean {
  return trial.ingestStatus === 'ready' && trial.videoCached;
}
