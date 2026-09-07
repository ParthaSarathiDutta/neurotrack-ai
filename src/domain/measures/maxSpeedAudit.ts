import type { Observation } from '../types';
import { filterInTrialObservations } from '../visualization/trialObservations';
import { computePathSpeedMetrics } from './pathMetrics';
import {
  classifySpeedIntervalExclusion,
  resolveSpeedIntervalReference,
  SPEED_INTERVAL_VALIDITY_ID,
} from './speedIntervalValidity';

export type MaxSpeedArtifactKind =
  | 'none'
  | 'container_timestamp_compression'
  | 'tracking_speed_outlier_flag'
  | 'tracking_jump';

export interface MaxSpeedIntervalAudit {
  maxSpeedPxPerSec: number;
  maxSpeedQualityGatedPxPerSec: number;
  prevFrameIndex: number;
  currFrameIndex: number;
  prevTimeUs: number;
  currTimeUs: number;
  deltaTimeUs: number;
  distancePx: number;
  prevOrigin: Observation['origin'];
  currOrigin: Observation['origin'];
  prevQualityFlags: Observation['qualityFlags'];
  currQualityFlags: Observation['qualityFlags'];
  artifactKind: MaxSpeedArtifactKind;
  artifactNote: string | null;
  referenceIntervalUs: number | null;
  excludedByPolicy: boolean;
  speedIntervalValidityPolicy: string;
}

function classifyArtifact(
  deltaTimeUs: number,
  referenceIntervalUs: number | null,
  prev: Observation,
  curr: Observation,
  excludedByPolicy: boolean,
): { kind: MaxSpeedArtifactKind; note: string | null } {
  const currFlags = curr.qualityFlags ?? [];
  const prevFlags = prev.qualityFlags ?? [];

  if (excludedByPolicy) {
    return {
      kind: 'container_timestamp_compression',
      note: `Excluded from scientific speed by ${SPEED_INTERVAL_VALIDITY_ID}: Δt ${deltaTimeUs} µs below reference threshold (reference interval ${referenceIntervalUs != null ? Math.round(referenceIntervalUs) : 'unknown'} µs). Unfiltered value preserved as diagnostic.`,
    };
  }

  if (currFlags.includes('speed_outlier') || prevFlags.includes('speed_outlier')) {
    return {
      kind: 'tracking_speed_outlier_flag',
      note: 'Tracking flagged speed_outlier on this interval; interval passed timestamp-quality gate.',
    };
  }

  return { kind: 'tracking_jump', note: null };
}

/** Read-only audit of raw max-speed pair vs quality-gated scientific max. */
export function auditMaxSpeedInterval(
  observations: Observation[],
  trialStartUs: number,
  censorUs: number,
): MaxSpeedIntervalAudit | null {
  const inTrial = filterInTrialObservations(observations, trialStartUs, censorUs);
  const reference = resolveSpeedIntervalReference(inTrial, undefined, trialStartUs, censorUs);
  const metrics = computePathSpeedMetrics(observations, trialStartUs, censorUs);

  let maxSpeedRaw = 0;
  let best: MaxSpeedIntervalAudit | null = null;

  for (let i = 1; i < inTrial.length; i += 1) {
    const prev = inTrial[i - 1]!;
    const curr = inTrial[i]!;
    if (
      prev.bodyXY == null ||
      curr.bodyXY == null ||
      prev.observed === 'lost' ||
      curr.observed === 'lost' ||
      prev.observed === 'absent_in_hole' ||
      curr.observed === 'absent_in_hole'
    ) {
      continue;
    }

    const deltaTimeUs = curr.timeUs - prev.timeUs;
    if (deltaTimeUs <= 0) continue;

    const distancePx = Math.hypot(
      curr.bodyXY.x - prev.bodyXY.x,
      curr.bodyXY.y - prev.bodyXY.y,
    );
    const speed = distancePx / (deltaTimeUs / 1_000_000);
    if (speed <= maxSpeedRaw) continue;

    maxSpeedRaw = speed;
    const exclusion = classifySpeedIntervalExclusion(
      deltaTimeUs,
      reference.referenceIntervalUs,
      prev,
      curr,
    );
    const excludedByPolicy = exclusion === 'timestamp_compression';
    const artifact = classifyArtifact(
      deltaTimeUs,
      reference.referenceIntervalUs,
      prev,
      curr,
      excludedByPolicy,
    );
    best = {
      maxSpeedPxPerSec: speed,
      maxSpeedQualityGatedPxPerSec: metrics.maxSpeedPxPerSec,
      prevFrameIndex: prev.frameIndex,
      currFrameIndex: curr.frameIndex,
      prevTimeUs: prev.timeUs,
      currTimeUs: curr.timeUs,
      deltaTimeUs,
      distancePx,
      prevOrigin: prev.origin,
      currOrigin: curr.origin,
      prevQualityFlags: prev.qualityFlags,
      currQualityFlags: curr.qualityFlags,
      artifactKind: artifact.kind,
      artifactNote: artifact.note,
      referenceIntervalUs: reference.referenceIntervalUs,
      excludedByPolicy,
      speedIntervalValidityPolicy: metrics.speedIntervalValidityPolicy,
    };
  }

  return best;
}
