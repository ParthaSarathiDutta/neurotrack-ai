import type { Observation, TimestampIndexEntry } from '../types';

export const SPEED_INTERVAL_VALIDITY_ID = 'speed_interval_validity.v1';
export const SPEED_INTERVAL_VALIDITY_VERSION = '1';

/**
 * Minimum Δt as a fraction of the recording reference interval.
 * Intervals shorter than this are treated as container timestamp compression
 * (not invented elapsed time) and excluded from speed aggregates only.
 */
export const TIMESTAMP_COMPRESSION_MIN_REFERENCE_FRACTION = 0.05;

export type SpeedIntervalExclusionReason =
  | 'zero_or_negative_dt'
  | 'tracking_gap'
  | 'timestamp_compression';

export interface SpeedIntervalReference {
  /** Median positive Δt between consecutive in-trial observations. */
  medianObservationIntervalUs: number | null;
  /** Median positive Δt from container timestamp index within the trial window. */
  medianTimestampIndexIntervalUs: number | null;
  /** Interval used for quality gating: observation median, else timestamp-index median. */
  referenceIntervalUs: number | null;
}

function medianPositive(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export function medianPositiveObservationIntervalUs(observations: Observation[]): number | null {
  const dts: number[] = [];
  for (let i = 1; i < observations.length; i += 1) {
    const dt = observations[i]!.timeUs - observations[i - 1]!.timeUs;
    if (dt > 0) dts.push(dt);
  }
  return medianPositive(dts);
}

export function medianPositiveTimestampIndexIntervalUs(
  timestampIndex: TimestampIndexEntry[],
  trialStartUs: number,
  censorUs: number,
): number | null {
  const inWindow = timestampIndex
    .filter((e) => e.timeUs >= trialStartUs && e.timeUs <= censorUs)
    .sort((a, b) => a.frameIndex - b.frameIndex);
  const dts: number[] = [];
  for (let i = 1; i < inWindow.length; i += 1) {
    const dt = inWindow[i]!.timeUs - inWindow[i - 1]!.timeUs;
    if (dt > 0) dts.push(dt);
  }
  return medianPositive(dts);
}

export function resolveSpeedIntervalReference(
  observations: Observation[],
  timestampIndex: TimestampIndexEntry[] | undefined,
  trialStartUs: number,
  censorUs: number,
): SpeedIntervalReference {
  const medianObservationIntervalUs = medianPositiveObservationIntervalUs(observations);
  const medianTimestampIndexIntervalUs =
    timestampIndex && timestampIndex.length > 1
      ? medianPositiveTimestampIndexIntervalUs(timestampIndex, trialStartUs, censorUs)
      : null;
  const referenceIntervalUs = medianObservationIntervalUs ?? medianTimestampIndexIntervalUs;
  return {
    medianObservationIntervalUs,
    medianTimestampIndexIntervalUs,
    referenceIntervalUs,
  };
}

export function isGapObservationForSpeed(obs: Observation): boolean {
  return (
    obs.bodyXY == null ||
    obs.observed === 'lost' ||
    obs.observed === 'absent_pre_trial' ||
    obs.observed === 'absent_in_hole'
  );
}

export function classifySpeedIntervalExclusion(
  deltaTimeUs: number,
  referenceIntervalUs: number | null,
  prev: Observation,
  curr: Observation,
): SpeedIntervalExclusionReason | null {
  if (isGapObservationForSpeed(prev) || isGapObservationForSpeed(curr)) {
    return 'tracking_gap';
  }
  if (deltaTimeUs <= 0) return 'zero_or_negative_dt';
  if (
    referenceIntervalUs != null &&
    deltaTimeUs < referenceIntervalUs * TIMESTAMP_COMPRESSION_MIN_REFERENCE_FRACTION
  ) {
    return 'timestamp_compression';
  }
  return null;
}

export function isSpeedIntervalQualityValid(
  deltaTimeUs: number,
  referenceIntervalUs: number | null,
  prev: Observation,
  curr: Observation,
): boolean {
  return classifySpeedIntervalExclusion(deltaTimeUs, referenceIntervalUs, prev, curr) == null;
}

export function speedIntervalValiditySummary(reference: SpeedIntervalReference): string {
  const ref = reference.referenceIntervalUs;
  const minDt = ref != null ? Math.round(ref * TIMESTAMP_COMPRESSION_MIN_REFERENCE_FRACTION) : null;
  return [
    `${SPEED_INTERVAL_VALIDITY_ID}@${SPEED_INTERVAL_VALIDITY_VERSION}`,
    ref != null ? `reference_interval_us:${Math.round(ref)}` : 'reference_interval_us:unknown',
    minDt != null ? `min_quality_dt_us:${minDt}` : null,
    reference.medianObservationIntervalUs != null
      ? `median_observation_dt_us:${Math.round(reference.medianObservationIntervalUs)}`
      : null,
    reference.medianTimestampIndexIntervalUs != null
      ? `median_timestamp_index_dt_us:${Math.round(reference.medianTimestampIndexIntervalUs)}`
      : null,
  ]
    .filter(Boolean)
    .join('; ');
}
