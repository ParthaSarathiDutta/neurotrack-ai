import type { CleaningParams, Observation } from '../types';
import { isSpeedOutlier } from '../tracking/trackQuality';

function cloneObservation(obs: Observation): Observation {
  return {
    ...obs,
    bodyXY: obs.bodyXY ? { ...obs.bodyXY } : null,
    noseXY: obs.noseXY ? { ...obs.noseXY } : null,
    qualityFlags: obs.qualityFlags ? [...obs.qualityFlags] : null,
  };
}

function isEligibleForGapFill(obs: Observation): boolean {
  return obs.observed !== 'absent_pre_trial' && obs.bodyXY == null;
}

/**
 * Interpolation factor for a gap frame between bracket indices.
 * Uses container timeUs when delta > 0; otherwise frameIndex spacing (duplicate PTS pairs).
 */
export function gapInterpolationFactor(
  prevIdx: number,
  nextIdx: number,
  gapFrameIndex: number,
  prevTimeUs: number,
  nextTimeUs: number,
  gapTimeUs: number,
): number {
  const deltaUs = nextTimeUs - prevTimeUs;
  if (deltaUs > 0) {
    return (gapTimeUs - prevTimeUs) / deltaUs;
  }
  const deltaFrames = nextIdx - prevIdx;
  if (deltaFrames <= 0) return 0;
  return (gapFrameIndex - prevIdx) / deltaFrames;
}

/** Linear interpolate body position; nose stays null; origin becomes interpolated. */
function interpolateBodies(
  observations: Observation[],
  maxGapFrames: number,
): Observation[] {
  const result = observations.map(cloneObservation);
  let i = 0;
  while (i < result.length) {
    if (result[i].bodyXY != null || !isEligibleForGapFill(result[i])) {
      i += 1;
      continue;
    }
    const gapStart = i;
    while (i < result.length && isEligibleForGapFill(result[i])) i += 1;
    const gapEnd = i - 1;
    const gapLen = gapEnd - gapStart + 1;
    const prevIdx = gapStart - 1;
    const nextIdx = i;
    const prev = prevIdx >= 0 ? result[prevIdx] : null;
    const next = nextIdx < result.length ? result[nextIdx] : null;
    if (
      prev?.bodyXY &&
      next?.bodyXY &&
      gapLen > 0 &&
      gapLen <= maxGapFrames &&
      nextIdx - prevIdx - 1 === gapLen
    ) {
      for (let g = gapStart; g <= gapEnd; g += 1) {
        const t = gapInterpolationFactor(
          prevIdx,
          nextIdx,
          g,
          prev.timeUs,
          next.timeUs,
          result[g].timeUs,
        );
        if (!Number.isFinite(t)) continue;
        result[g] = {
          ...result[g],
          bodyXY: {
            x: prev.bodyXY.x + t * (next.bodyXY.x - prev.bodyXY.x),
            y: prev.bodyXY.y + t * (next.bodyXY.y - prev.bodyXY.y),
          },
          noseXY: null,
          observed: 'tracked',
          origin: 'interpolated',
          confidence: 0.5,
          qualityFlags: null,
        };
      }
    }
  }
  return result;
}

/** Replace isolated speed outliers with linear interpolation when bracketed. */
function handleOutliers(
  observations: Observation[],
  maxSpeedPxPerSec: number,
): Observation[] {
  const result = observations.map(cloneObservation);
  for (let i = 1; i < result.length; i += 1) {
    const prev = result[i - 1];
    const curr = result[i];
    if (!prev.bodyXY || !curr.bodyXY) continue;
    const deltaUs = curr.timeUs - prev.timeUs;
    if (deltaUs <= 0) continue;
    if (!isSpeedOutlier(prev.bodyXY, curr.bodyXY, deltaUs, maxSpeedPxPerSec)) continue;

    const prev2 = i >= 2 ? result[i - 2] : null;
    const next = i + 1 < result.length ? result[i + 1] : null;
    if (prev2?.bodyXY && next?.bodyXY && result[i - 1].bodyXY) {
      result[i] = {
        ...curr,
        bodyXY: {
          x: (prev2.bodyXY.x + next.bodyXY.x) / 2,
          y: (prev2.bodyXY.y + next.bodyXY.y) / 2,
        },
        noseXY: null,
        origin: curr.origin === 'manual' ? 'manual' : 'interpolated',
        observed: 'tracked',
      };
    }
  }
  return result;
}

/** Moving average on body XY; skips manual corrections; never fabricates nose. */
function smoothBodies(observations: Observation[], windowSize: number): Observation[] {
  if (windowSize <= 1) return observations.map(cloneObservation);
  const half = Math.floor(windowSize / 2);
  const result = observations.map(cloneObservation);

  for (let i = 0; i < result.length; i += 1) {
    const currentBody = result[i].bodyXY;
    if (result[i].origin === 'manual' || !currentBody) continue;
    const neighbors: Array<{ x: number; y: number }> = [];
    for (let j = i - half; j <= i + half; j += 1) {
      if (j < 0 || j >= result.length) continue;
      if (j !== i && result[j].origin === 'manual') continue;
      const neighborBody = result[j].bodyXY;
      if (neighborBody) neighbors.push(neighborBody);
    }
    if (neighbors.length < 2) continue;
    const avgX = neighbors.reduce((s, p) => s + p.x, 0) / neighbors.length;
    const avgY = neighbors.reduce((s, p) => s + p.y, 0) / neighbors.length;
    if (!Number.isFinite(avgX) || !Number.isFinite(avgY)) continue;
    if (Math.hypot(avgX - currentBody.x, avgY - currentBody.y) < 0.5) continue;
    result[i] = {
      ...result[i],
      bodyXY: { x: avgX, y: avgY },
      origin: 'smoothed',
      noseXY: result[i].noseXY,
    };
  }
  return result;
}

/** Compute cleaned trajectory preview/apply output from corrected-base observations. */
export function computeCleanedTrajectory(
  baseObservations: Observation[],
  params: CleaningParams,
  trackingMaxSpeedPxPerSec: number,
): Observation[] {
  let obs = interpolateBodies(baseObservations, params.maxGapFrames);
  obs = handleOutliers(obs, trackingMaxSpeedPxPerSec * params.outlierSpeedMultiplier);
  if (params.smoothingWindow > 1) {
    obs = smoothBodies(obs, params.smoothingWindow);
  }
  return obs;
}

export { interpolateBodies, handleOutliers, smoothBodies };
