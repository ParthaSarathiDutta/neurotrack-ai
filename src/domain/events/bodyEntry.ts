/**
 * NeuroTrack default body-entry completion (definition v1).
 * @see reference/neurotrack-body-entry-v1.md
 */
import { dist } from './holeProximity';
import type { EventDetectionParams, Hole, Observation } from '../types';

export const BODY_ENTRY_DEFINITION_ID = 'neurotrack_body_entry';
export const BODY_ENTRY_DEFINITION_VERSION = '1';

export interface BodyEntryFrameMetrics {
  frameIndex: number;
  timeUs: number;
  platformBlobArea: number;
  holeDarkening: number;
  bodyDistPx: number | null;
  meetsTorsoProximity: boolean;
  meetsPixelEntry: boolean;
  meetsBodyEntry: boolean;
}

export interface BodyEntryCompletionResult {
  established: boolean;
  completionFrameIndex: number | null;
  completionTimeUs: number | null;
  temporalSupportFrames: number;
  definitionId: string;
  definitionVersion: string;
  /** Aggregate area decay — supporting evidence only. */
  areaDecayScore: number | null;
  failureReason: string | null;
  frameMetrics: BodyEntryFrameMetrics[];
}

export interface BodyEntryDetectionInput {
  frameIndices: number[];
  timeUsByFrame: Map<number, number>;
  platformBlobAreas: number[];
  holeDarkenings: number[];
  observationsByFrame: Map<number, Observation>;
  hole: Hole;
  platformRadiusPx: number;
  params: EventDetectionParams;
  censorFrameIndex: number;
}

function observationAt(
  observationsByFrame: Map<number, Observation>,
  frameIndex: number,
): Observation | null {
  return observationsByFrame.get(frameIndex) ?? null;
}

/** Per-frame torso + pixel entry signals (chronological samples). */
export function buildBodyEntryFrameMetrics(
  input: Omit<BodyEntryDetectionInput, 'censorFrameIndex'>,
): BodyEntryFrameMetrics[] {
  const { frameIndices, timeUsByFrame, platformBlobAreas, holeDarkenings, observationsByFrame, hole, platformRadiusPx, params } =
    input;

  if (frameIndices.length === 0) return [];

  const earlyCount = Math.max(1, Math.ceil(frameIndices.length * 0.25));
  const earlyBaseline =
    platformBlobAreas.slice(0, earlyCount).reduce((a, b) => a + b, 0) / earlyCount;
  const areaThreshold =
    earlyBaseline > 10 ? earlyBaseline * params.bodyEntryPlatformAreaMaxFraction : Infinity;
  const torsoMaxDist = platformRadiusPx * params.bodyEntryTorsoProximityFraction;

  return frameIndices.map((frameIndex, i) => {
    const obs = observationAt(observationsByFrame, frameIndex);
    const bodyDistPx = obs?.bodyXY ? dist(obs.bodyXY, hole) : null;
    const meetsTorsoProximity = bodyDistPx != null && bodyDistPx <= torsoMaxDist;
    const meetsPixelEntry =
      holeDarkenings[i]! >= params.bodyEntryHoleDarkeningMin &&
      platformBlobAreas[i]! <= areaThreshold;
    const meetsBodyEntry = meetsTorsoProximity && meetsPixelEntry;

    return {
      frameIndex,
      timeUs: timeUsByFrame.get(frameIndex) ?? 0,
      platformBlobArea: platformBlobAreas[i]!,
      holeDarkening: holeDarkenings[i]!,
      bodyDistPx,
      meetsTorsoProximity,
      meetsPixelEntry,
      meetsBodyEntry,
    };
  });
}

/**
 * First temporally supported body-entry completion frame, or null if not established.
 * Never returns censor/recording frame unless that frame itself qualifies with support.
 */
export function detectBodyEntryCompletion(
  input: BodyEntryDetectionInput,
): BodyEntryCompletionResult {
  const metrics = buildBodyEntryFrameMetrics(input);
  const earlyCount = Math.max(1, Math.ceil(metrics.length * 0.25));
  const lateCount = Math.max(1, Math.ceil(metrics.length * 0.25));
  const earlyMean =
    metrics.slice(0, earlyCount).reduce((s, m) => s + m.platformBlobArea, 0) / earlyCount;
  const lateMean =
    metrics.slice(-lateCount).reduce((s, m) => s + m.platformBlobArea, 0) / lateCount;
  const areaDecayScore =
    earlyMean > 10 ? Math.max(0, Math.min(1, 1 - lateMean / earlyMean)) : 0;

  const minFrames = input.params.bodyEntryTemporalMinFrames;
  let completionFrameIndex: number | null = null;
  let completionTimeUs: number | null = null;
  let temporalSupportFrames = 0;

  for (let start = 0; start <= metrics.length - minFrames; start += 1) {
    let run = 0;
    for (let j = start; j < metrics.length; j += 1) {
      if (!metrics[j]!.meetsBodyEntry) break;
      run += 1;
    }
    if (run >= minFrames) {
      const first = metrics[start]!;
      completionFrameIndex = first.frameIndex;
      completionTimeUs = first.timeUs;
      temporalSupportFrames = run;
      break;
    }
  }

  if (completionFrameIndex == null) {
    return {
      established: false,
      completionFrameIndex: null,
      completionTimeUs: null,
      temporalSupportFrames: 0,
      definitionId: BODY_ENTRY_DEFINITION_ID,
      definitionVersion: BODY_ENTRY_DEFINITION_VERSION,
      areaDecayScore,
      failureReason: 'no_temporally_supported_body_entry',
      frameMetrics: metrics,
    };
  }

  // Recording-end guard: do not accept completion solely because the censor frame meets
  // criteria once — require the qualifying run to begin before the final frame.
  if (
    completionFrameIndex === input.censorFrameIndex &&
    temporalSupportFrames === 1 &&
    metrics.length > 1
  ) {
    return {
      established: false,
      completionFrameIndex: null,
      completionTimeUs: null,
      temporalSupportFrames: 0,
      definitionId: BODY_ENTRY_DEFINITION_ID,
      definitionVersion: BODY_ENTRY_DEFINITION_VERSION,
      areaDecayScore,
      failureReason: 'insufficient_temporal_support_at_recording_end',
      frameMetrics: metrics,
    };
  }

  return {
    established: true,
    completionFrameIndex,
    completionTimeUs,
    temporalSupportFrames,
    definitionId: BODY_ENTRY_DEFINITION_ID,
    definitionVersion: BODY_ENTRY_DEFINITION_VERSION,
    areaDecayScore,
    failureReason: null,
    frameMetrics: metrics,
  };
}
