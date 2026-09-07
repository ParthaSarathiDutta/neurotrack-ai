import type { Observation } from '../types';
import { filterInTrialObservations } from '../visualization/trialObservations';

export type MaxSpeedArtifactKind =
  | 'none'
  | 'container_timestamp_compression'
  | 'tracking_speed_outlier_flag'
  | 'tracking_jump';

export interface MaxSpeedIntervalAudit {
  maxSpeedPxPerSec: number;
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
  medianIntervalUs: number | null;
}

function medianIntervalUs(observations: Observation[]): number | null {
  const dts: number[] = [];
  for (let i = 1; i < observations.length; i += 1) {
    const dt = observations[i]!.timeUs - observations[i - 1]!.timeUs;
    if (dt > 0) dts.push(dt);
  }
  if (dts.length === 0) return null;
  dts.sort((a, b) => a - b);
  const mid = Math.floor(dts.length / 2);
  return dts.length % 2 === 0 ? (dts[mid - 1]! + dts[mid]!) / 2 : dts[mid]!;
}

function classifyArtifact(
  deltaTimeUs: number,
  medianUs: number | null,
  prev: Observation,
  curr: Observation,
): { kind: MaxSpeedArtifactKind; note: string | null } {
  const currFlags = curr.qualityFlags ?? [];
  const prevFlags = prev.qualityFlags ?? [];

  if (currFlags.includes('speed_outlier') || prevFlags.includes('speed_outlier')) {
    return {
      kind: 'tracking_speed_outlier_flag',
      note:
        'Tracking flagged a speed outlier on this interval. Max speed still follows MS-5 D12 (valid when Δt > 0).',
    };
  }

  if (medianUs != null && deltaTimeUs > 0 && deltaTimeUs < medianUs * 0.05) {
    return {
      kind: 'container_timestamp_compression',
      note: `Container timestamps compress to ${deltaTimeUs} µs between frames ${prev.frameIndex} and ${curr.frameIndex} (median interval ${Math.round(medianUs)} µs). Displacement is plausible at normal frame spacing but inflates instantaneous speed.`,
    };
  }

  if (deltaTimeUs > 0 && deltaTimeUs <= 1000) {
    return {
      kind: 'container_timestamp_compression',
      note: `Sub-millisecond Δt (${deltaTimeUs} µs) between consecutive frames inflates instantaneous speed per MS-5 D12 valid-interval rules.`,
    };
  }

  return { kind: 'tracking_jump', note: null };
}

/** Read-only audit of the max-speed contributing pair; does not alter measures. */
export function auditMaxSpeedInterval(
  observations: Observation[],
  trialStartUs: number,
  censorUs: number,
): MaxSpeedIntervalAudit | null {
  const inTrial = filterInTrialObservations(observations, trialStartUs, censorUs);
  const medianUs = medianIntervalUs(inTrial);

  let maxSpeed = 0;
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
    if (speed <= maxSpeed) continue;

    maxSpeed = speed;
    const artifact = classifyArtifact(deltaTimeUs, medianUs, prev, curr);
    best = {
      maxSpeedPxPerSec: speed,
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
      medianIntervalUs: medianUs,
    };
  }

  return best;
}
