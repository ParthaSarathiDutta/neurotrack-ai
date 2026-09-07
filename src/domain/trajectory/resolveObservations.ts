import { applyManualCorrections } from './manualCorrection';
import { isAppliedCleaningConsumable } from './cleaningStaleness';
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
 * Stale applied cleaning is never consumed — preview or re-apply required.
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
  if (isAppliedCleaningConsumable(track.appliedCleaning)) {
    return mergeCleaningWithManual(
      corrected,
      track.appliedCleaning!.observations,
      corrections,
    );
  }
  return corrected;
}

/** Observations safe for MS-5 measures/export — null when only stale cleaning exists. */
export function consumableCleanedObservations(track: Track | null | undefined): Observation[] | null {
  if (!track?.observations.length) return null;
  const corrections = track.manualCorrections ?? [];
  const corrected = applyManualCorrections(track.observations, corrections);
  if (!isAppliedCleaningConsumable(track.appliedCleaning)) return null;
  return mergeCleaningWithManual(corrected, track.appliedCleaning!.observations, corrections);
}

export function observationAtFrame(
  observations: Observation[],
  frameIndex: number,
): Observation | null {
  return observations.find((o) => o.frameIndex === frameIndex) ?? null;
}
