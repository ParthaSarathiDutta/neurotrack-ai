import type { CleaningParams, Observation, ObservationQualityFlag } from '../types';
import { isSpeedOutlier, mergeQualityFlags } from '../tracking/trackQuality';

function cloneObservation(obs: Observation): Observation {
  return {
    ...obs,
    bodyXY: obs.bodyXY ? { ...obs.bodyXY } : null,
    noseXY: obs.noseXY ? { ...obs.noseXY } : null,
    qualityFlags: obs.qualityFlags ? [...obs.qualityFlags] : null,
  };
}

/** Only short `lost` gaps between tracked brackets may be filled. */
function isEligibleForGapFill(obs: Observation): boolean {
  return obs.observed === 'lost' && obs.bodyXY == null;
}

function isAbsenceBoundary(obs: Observation): boolean {
  return obs.observed === 'absent_pre_trial' || obs.observed === 'absent_in_hole';
}

function hasBracketBody(obs: Observation | null): obs is Observation & { bodyXY: { x: number; y: number } } {
  return Boolean(obs?.bodyXY && !isAbsenceBoundary(obs));
}

const SMOOTHING_BLOCK_FLAGS: ObservationQualityFlag[] = [
  'near_hole_disappearance',
  'possible_occlusion',
  'speed_outlier',
  'ambiguous_head_tail',
];

function isSmoothingBlocked(obs: Observation): boolean {
  if (isAbsenceBoundary(obs)) return true;
  if (!obs.bodyXY) return true;
  return obs.qualityFlags?.some((f) => SMOOTHING_BLOCK_FLAGS.includes(f)) ?? false;
}

/** True if any frame strictly between a and b is an absence boundary or lacks a body. */
function hasUnsupportedSpan(observations: Observation[], a: number, b: number): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  for (let k = lo + 1; k < hi; k += 1) {
    const o = observations[k];
    if (isAbsenceBoundary(o)) return true;
    if (!o.bodyXY) return true;
  }
  return false;
}

/**
 * Interpolation factor for a gap frame between bracket indices.
 * Uses container timeUs when delta > 0; otherwise frameIndex spacing (duplicate PTS pairs).
 * Never used for speed or elapsed-time inference.
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

function gapDurationEligible(prevTimeUs: number, nextTimeUs: number, maxGapDurationUs: number): boolean {
  const deltaUs = nextTimeUs - prevTimeUs;
  if (deltaUs <= 0) return true;
  return deltaUs <= maxGapDurationUs;
}

/** Linear interpolate body position; preserves observed/flags; origin identifies interpolation. */
function interpolateBodies(
  observations: Observation[],
  maxGapFrames: number,
  maxGapDurationUs: number,
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
      hasBracketBody(prev) &&
      hasBracketBody(next) &&
      gapLen > 0 &&
      gapLen <= maxGapFrames &&
      nextIdx - prevIdx - 1 === gapLen &&
      gapDurationEligible(prev.timeUs, next.timeUs, maxGapDurationUs)
    ) {
      const duplicatePtsSpan = next.timeUs - prev.timeUs <= 0;
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
        const flags: ObservationQualityFlag[] = ['gap_interpolated'];
        if (duplicatePtsSpan) flags.push('duplicate_pts_spatial_estimate');
        result[g] = {
          ...result[g],
          bodyXY: {
            x: prev.bodyXY.x + t * (next.bodyXY.x - prev.bodyXY.x),
            y: prev.bodyXY.y + t * (next.bodyXY.y - prev.bodyXY.y),
          },
          noseXY: null,
          observed: result[g].observed,
          origin: 'interpolated',
          confidence: result[g].confidence,
          qualityFlags: mergeQualityFlags(result[g].qualityFlags, flags),
        };
      }
    }
  }
  return result;
}

/** Replace isolated speed outliers when bracketed; raw layer remains unchanged elsewhere. */
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
        noseXY: curr.noseXY,
        observed: curr.observed,
        origin: curr.origin === 'manual' ? 'manual' : 'interpolated',
        qualityFlags: mergeQualityFlags(curr.qualityFlags, ['speed_outlier_replaced']),
      };
    }
  }
  return result;
}

/** Moving average on body XY; skips manual anchors and blocked spans. */
function smoothBodies(observations: Observation[], windowSize: number): Observation[] {
  if (windowSize <= 1) return observations.map(cloneObservation);
  const half = Math.floor(windowSize / 2);
  const result = observations.map(cloneObservation);

  for (let i = 0; i < result.length; i += 1) {
    const currentBody = result[i].bodyXY;
    if (result[i].origin === 'manual' || !currentBody || isSmoothingBlocked(result[i])) continue;

    const neighbors: Array<{ x: number; y: number }> = [];
    for (let j = i - half; j <= i + half; j += 1) {
      if (j < 0 || j >= result.length || j === i) continue;
      if (result[j].origin === 'manual') continue;
      if (isSmoothingBlocked(result[j])) continue;
      if (hasUnsupportedSpan(result, j, i)) continue;
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
      observed: result[i].observed,
      qualityFlags: result[i].qualityFlags,
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
  let obs = interpolateBodies(
    baseObservations,
    params.maxGapFrames,
    params.maxGapDurationUs,
  );
  obs = handleOutliers(obs, trackingMaxSpeedPxPerSec * params.outlierSpeedMultiplier);
  if (params.smoothingWindow > 1) {
    obs = smoothBodies(obs, params.smoothingWindow);
  }
  return obs;
}

export { interpolateBodies, handleOutliers, smoothBodies };
