import type { Observation, TimestampIndexEntry } from '../types';
import {
  SPEED_INTERVAL_VALIDITY_ID,
  classifySpeedIntervalExclusion,
  isGapObservationForSpeed,
  resolveSpeedIntervalReference,
  speedIntervalValiditySummary,
} from './speedIntervalValidity';

export interface PathSpeedMetrics {
  pathLengthPx: number;
  /** Quality-gated scientific mean speed (timestamp-valid intervals only). */
  meanSpeedPxPerSec: number;
  /** Quality-gated scientific max speed; 0 when no quality-valid intervals exist. */
  maxSpeedPxPerSec: number;
  maxSpeedQualityValid: boolean;
  /** D12 raw aggregates (Δt > 0, gaps excluded) — diagnostic only. */
  meanSpeedRawPxPerSec: number;
  maxSpeedRawPxPerSec: number;
  qualityGatedIntervalCount: number;
  rawSpeedIntervalCount: number;
  excludedZeroDtPairs: number;
  excludedTimestampCompressionPairs: number;
  pathLengthExcludedGapUs: number;
  includesInterpolatedSegments: boolean;
  speedIntervalValidityPolicy: string;
  referenceIntervalUs: number | null;
  medianObservationIntervalUs: number | null;
  /** @deprecated Use qualityGatedIntervalCount */
  validSpeedIntervalCount: number;
}

/** Path length and speed per MS-5 D12 with speed_interval_validity.v1 quality gating. */
export function computePathSpeedMetrics(
  observations: Observation[],
  trialStartUs: number,
  censorUs: number,
  timestampIndex?: TimestampIndexEntry[],
): PathSpeedMetrics {
  const inTrial = observations
    .filter((o) => o.timeUs >= trialStartUs && o.timeUs <= censorUs && o.observed !== 'absent_pre_trial')
    .sort((a, b) => a.frameIndex - b.frameIndex);

  const reference = resolveSpeedIntervalReference(
    inTrial,
    timestampIndex,
    trialStartUs,
    censorUs,
  );

  let pathLengthPx = 0;
  let weightedSpeedSum = 0;
  let weightSumUs = 0;
  let maxSpeed = 0;
  let rawWeightedSpeedSum = 0;
  let rawWeightSumUs = 0;
  let maxSpeedRaw = 0;
  let qualityGatedIntervals = 0;
  let rawSpeedIntervals = 0;
  let excludedZeroDt = 0;
  let excludedTimestampCompression = 0;
  let excludedGapUs = 0;
  let includesInterpolated = false;

  for (let i = 1; i < inTrial.length; i += 1) {
    const prev = inTrial[i - 1]!;
    const curr = inTrial[i]!;
    const dtUs = curr.timeUs - prev.timeUs;

    if (isGapObservationForSpeed(prev) || isGapObservationForSpeed(curr)) {
      excludedGapUs += Math.max(0, dtUs);
      continue;
    }

    const dist = Math.hypot(curr.bodyXY!.x - prev.bodyXY!.x, curr.bodyXY!.y - prev.bodyXY!.y);
    pathLengthPx += dist;

    if (curr.origin === 'interpolated' || prev.origin === 'interpolated') {
      includesInterpolated = true;
    }

    if (dtUs <= 0) {
      excludedZeroDt += 1;
      continue;
    }

    const speed = dist / (dtUs / 1_000_000);
    rawSpeedIntervals += 1;
    rawWeightedSpeedSum += speed * dtUs;
    rawWeightSumUs += dtUs;
    if (speed > maxSpeedRaw) maxSpeedRaw = speed;

    const exclusion = classifySpeedIntervalExclusion(
      dtUs,
      reference.referenceIntervalUs,
      prev,
      curr,
    );
    if (exclusion === 'timestamp_compression') {
      excludedTimestampCompression += 1;
      continue;
    }

    qualityGatedIntervals += 1;
    weightedSpeedSum += speed * dtUs;
    weightSumUs += dtUs;
    if (speed > maxSpeed) maxSpeed = speed;
  }

  return {
    pathLengthPx,
    meanSpeedPxPerSec: weightSumUs > 0 ? weightedSpeedSum / weightSumUs : 0,
    maxSpeedPxPerSec: maxSpeed,
    maxSpeedQualityValid: qualityGatedIntervals > 0,
    meanSpeedRawPxPerSec: rawWeightSumUs > 0 ? rawWeightedSpeedSum / rawWeightSumUs : 0,
    maxSpeedRawPxPerSec: maxSpeedRaw,
    qualityGatedIntervalCount: qualityGatedIntervals,
    rawSpeedIntervalCount: rawSpeedIntervals,
    excludedZeroDtPairs: excludedZeroDt,
    excludedTimestampCompressionPairs: excludedTimestampCompression,
    pathLengthExcludedGapUs: excludedGapUs,
    includesInterpolatedSegments: includesInterpolated,
    speedIntervalValidityPolicy: speedIntervalValiditySummary(reference),
    referenceIntervalUs: reference.referenceIntervalUs,
    medianObservationIntervalUs: reference.medianObservationIntervalUs,
    validSpeedIntervalCount: qualityGatedIntervals,
  };
}

export { SPEED_INTERVAL_VALIDITY_ID };
