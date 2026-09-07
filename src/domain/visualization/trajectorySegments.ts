import type { Observation } from '../types';
import {
  filterInTrialObservations,
  isUnsupportedTrajectoryGap,
  trialRelativeSec,
} from './trialObservations';

export type TrajectoryProvenance = 'auto' | 'manual' | 'interpolated' | 'smoothed' | 'mixed';

export interface TrajectoryPoint {
  x: number;
  y: number;
  frameIndex: number;
  timeUs: number;
  origin: Observation['origin'];
  timeSec: number;
}

export interface TrajectorySegment {
  points: TrajectoryPoint[];
  provenance: TrajectoryProvenance;
  startTimeSec: number;
  endTimeSec: number;
}

function segmentProvenance(points: TrajectoryPoint[]): TrajectoryProvenance {
  const origins = new Set(points.map((p) => p.origin));
  if (origins.size === 1) {
    const only = [...origins][0]!;
    if (only === 'manual' || only === 'interpolated' || only === 'smoothed' || only === 'auto') {
      return only;
    }
  }
  return 'mixed';
}

/** Build drawable trajectory segments; never connects across unsupported tracking gaps. */
export function buildTrajectorySegments(
  observations: Observation[],
  trialStartUs: number,
  censorUs: number,
): TrajectorySegment[] {
  const inTrial = filterInTrialObservations(observations, trialStartUs, censorUs);
  const segments: TrajectorySegment[] = [];
  let current: TrajectoryPoint[] = [];

  const flush = () => {
    if (current.length >= 2) {
      segments.push({
        points: current,
        provenance: segmentProvenance(current),
        startTimeSec: current[0]!.timeSec,
        endTimeSec: current[current.length - 1]!.timeSec,
      });
    }
    current = [];
  };

  for (const obs of inTrial) {
    if (isUnsupportedTrajectoryGap(obs)) {
      flush();
      continue;
    }
    current.push({
      x: obs.bodyXY!.x,
      y: obs.bodyXY!.y,
      frameIndex: obs.frameIndex,
      timeUs: obs.timeUs,
      origin: obs.origin,
      timeSec: trialRelativeSec(obs.timeUs, trialStartUs),
    });
  }
  flush();
  return segments;
}

/** Grayscale-safe time color (0 = early, 1 = late). */
export function trajectoryTimeColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const gray = Math.round(40 + clamped * 175);
  return `rgb(${gray}, ${gray}, ${gray})`;
}
