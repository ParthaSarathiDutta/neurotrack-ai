import type { Observation } from '../types';

export interface PathSpeedMetrics {
  pathLengthPx: number;
  meanSpeedPxPerSec: number;
  maxSpeedPxPerSec: number;
  validSpeedIntervalCount: number;
  excludedZeroDtPairs: number;
  pathLengthExcludedGapUs: number;
  includesInterpolatedSegments: boolean;
}

function isGapObservation(obs: Observation): boolean {
  return (
    obs.bodyXY == null ||
    obs.observed === 'lost' ||
    obs.observed === 'absent_pre_trial' ||
    obs.observed === 'absent_in_hole'
  );
}

/** Path length and speed per MS-5 D12 — duplicate PTS: include displacement in path, exclude from speed. */
export function computePathSpeedMetrics(
  observations: Observation[],
  trialStartUs: number,
  censorUs: number,
): PathSpeedMetrics {
  const inTrial = observations
    .filter((o) => o.timeUs >= trialStartUs && o.timeUs <= censorUs && o.observed !== 'absent_pre_trial')
    .sort((a, b) => a.frameIndex - b.frameIndex);

  let pathLengthPx = 0;
  let weightedSpeedSum = 0;
  let weightSumUs = 0;
  let maxSpeed = 0;
  let validIntervals = 0;
  let excludedZeroDt = 0;
  let excludedGapUs = 0;
  let includesInterpolated = false;

  for (let i = 1; i < inTrial.length; i += 1) {
    const prev = inTrial[i - 1]!;
    const curr = inTrial[i]!;
    const dtUs = curr.timeUs - prev.timeUs;

    if (isGapObservation(prev) || isGapObservation(curr)) {
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
    validIntervals += 1;
    weightedSpeedSum += speed * dtUs;
    weightSumUs += dtUs;
    if (speed > maxSpeed) maxSpeed = speed;
  }

  return {
    pathLengthPx,
    meanSpeedPxPerSec: weightSumUs > 0 ? weightedSpeedSum / weightSumUs : 0,
    maxSpeedPxPerSec: maxSpeed,
    validSpeedIntervalCount: validIntervals,
    excludedZeroDtPairs: excludedZeroDt,
    pathLengthExcludedGapUs: excludedGapUs,
    includesInterpolatedSegments: includesInterpolated,
  };
}
