import { applyManualCorrections } from './manualCorrection';
import { isAppliedCleaningConsumable } from './cleaningStaleness';
import { mergeCleaningWithManual } from './resolveObservations';
import type { MeasurementBasis, Observation, Track } from '../types';

export interface MeasurementObservationsResult {
  observations: Observation[];
  unavailable: boolean;
  unavailableReason: string | null;
  basisUsed: MeasurementBasis;
}

/** Resolve trajectory for MS-5 event detection and measures. Never uses stale cleaning. */
export function resolveMeasurementObservations(
  track: Track | null | undefined,
  basis: MeasurementBasis,
): MeasurementObservationsResult {
  if (!track?.observations?.length) {
    return {
      observations: [],
      unavailable: true,
      unavailableReason: 'No tracking data.',
      basisUsed: basis,
    };
  }

  if (basis === 'raw') {
    return {
      observations: track.observations,
      unavailable: false,
      unavailableReason: null,
      basisUsed: 'raw',
    };
  }

  const corrected = applyManualCorrections(track.observations, track.manualCorrections ?? []);

  if (basis === 'corrected') {
    return {
      observations: corrected,
      unavailable: false,
      unavailableReason: null,
      basisUsed: 'corrected',
    };
  }

  if (!isAppliedCleaningConsumable(track.appliedCleaning)) {
    return {
      observations: [],
      unavailable: true,
      unavailableReason: 'Applied cleaning is stale or missing — choose Raw or Corrected basis.',
      basisUsed: 'cleaned',
    };
  }

  return {
    observations: mergeCleaningWithManual(
      corrected,
      track.appliedCleaning!.observations,
      track.manualCorrections ?? [],
    ),
    unavailable: false,
    unavailableReason: null,
    basisUsed: 'cleaned',
  };
}
