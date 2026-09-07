import type { Observation } from '../types';

/** In-trial observations sorted by frame index for visualization and occupancy. */
export function filterInTrialObservations(
  observations: Observation[],
  trialStartUs: number,
  censorUs: number,
): Observation[] {
  return observations
    .filter(
      (o) =>
        o.timeUs >= trialStartUs &&
        o.timeUs <= censorUs &&
        o.observed !== 'absent_pre_trial',
    )
    .sort((a, b) => a.frameIndex - b.frameIndex);
}

export function isUnsupportedTrajectoryGap(obs: Observation): boolean {
  return (
    obs.bodyXY == null ||
    obs.observed === 'lost' ||
    obs.observed === 'absent_in_hole'
  );
}

export function trialRelativeSec(timeUs: number, trialStartUs: number): number {
  return (timeUs - trialStartUs) / 1_000_000;
}
