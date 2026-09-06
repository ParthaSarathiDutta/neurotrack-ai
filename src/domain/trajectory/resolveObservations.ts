import { applyManualCorrections } from './manualCorrection';
import type { ManualCorrection, Observation, Track } from '../types';

const manualFrameSet = (corrections: ManualCorrection[]) =>
  new Set(corrections.map((c) => c.frameIndex));

/** Merge cleaned layer with manual corrections — manual always wins at its frameIndex. */
export function mergeCleaningWithManual(
  correctedBase: Observation[],
  cleaned: Observation[],
  corrections: ManualCorrection[],
): Observation[] {
  const manualFrames = manualFrameSet(corrections);
  const correctedByFrame = new Map(correctedBase.map((o) => [o.frameIndex, o]));
  return cleaned.map((cleanObs) => {
    if (manualFrames.has(cleanObs.frameIndex)) {
      return correctedByFrame.get(cleanObs.frameIndex) ?? cleanObs;
    }
    return cleanObs;
  });
}

export interface ResolveObservationOptions {
  /** Non-persisted cleaning preview from session store. */
  cleaningPreview?: Observation[] | null;
}

/**
 * Effective observations for display and downstream MS-5+ consumers.
 * Order: raw → manual corrections → applied cleaning or preview (manual overrides cleaning).
 */
export function resolveEffectiveObservations(
  track: Track | null | undefined,
  options: ResolveObservationOptions = {},
): Observation[] {
  if (!track?.observations?.length) return [];
  const corrections = track.manualCorrections ?? [];
  const corrected = applyManualCorrections(track.observations, corrections);

  if (options.cleaningPreview?.length) {
    return mergeCleaningWithManual(corrected, options.cleaningPreview, corrections);
  }
  if (track.appliedCleaning?.observations?.length) {
    return mergeCleaningWithManual(corrected, track.appliedCleaning.observations, corrections);
  }
  return corrected;
}

export function observationAtFrame(
  observations: Observation[],
  frameIndex: number,
): Observation | null {
  return observations.find((o) => o.frameIndex === frameIndex) ?? null;
}
