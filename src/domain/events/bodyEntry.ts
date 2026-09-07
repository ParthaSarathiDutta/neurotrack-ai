/**
 * NeuroTrack default body-entry completion (definition v2).
 * @see reference/neurotrack-body-entry-v2.md
 */
import { dist } from './holeProximity';
import type { EventDetectionParams, Hole, Observation } from '../types';

export const BODY_ENTRY_DEFINITION_ID = 'neurotrack_body_entry';
export const BODY_ENTRY_DEFINITION_VERSION = '2';

export type BodyEntryPath = 'centroid_pixel' | 'occlusion_pixel' | null;

export interface BodyEntryFrameMetrics {
  frameIndex: number;
  timeUs: number;
  platformBlobArea: number;
  holeDarkening: number;
  bodyDistPx: number | null;
  /** Strict 6% centroid gate — supporting evidence (Path A). */
  meetsTorsoProximity: boolean;
  /** Phase-A approach zone (12% radius). */
  meetsApproachProximity: boolean;
  /** Hole darkening + reduced platform remnant. */
  meetsPixelTorsoEntry: boolean;
  /** @deprecated alias */ meetsPixelEntry: boolean;
  /** Path A or Path B at this frame. */
  meetsBodyEntry: boolean;
  entryPath: BodyEntryPath;
}

export interface BodyEntryCompletionResult {
  established: boolean;
  completionFrameIndex: number | null;
  completionTimeUs: number | null;
  temporalSupportFrames: number;
  definitionId: string;
  definitionVersion: string;
  completionPath: BodyEntryPath;
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

function occlusionStepValid(
  earlier: BodyEntryFrameMetrics,
  later: BodyEntryFrameMetrics,
  params: EventDetectionParams,
): boolean {
  if (!earlier.meetsApproachProximity || !earlier.meetsPixelTorsoEntry) return false;
  if (!later.meetsApproachProximity || !later.meetsPixelTorsoEntry) return false;
  const darkeningProgress =
    later.holeDarkening >= earlier.holeDarkening - params.bodyEntryDarkeningProgressEps;
  const areaProgress =
    later.platformBlobArea <= earlier.platformBlobArea + params.bodyEntryAreaProgressPx;
  return darkeningProgress || areaProgress;
}

function frameEntryPath(
  metrics: BodyEntryFrameMetrics[],
  index: number,
  params: EventDetectionParams,
): BodyEntryPath {
  const m = metrics[index]!;
  if (m.meetsTorsoProximity && m.meetsPixelTorsoEntry) return 'centroid_pixel';
  if (index > 0 && occlusionStepValid(metrics[index - 1]!, m, params)) return 'occlusion_pixel';
  if (index + 1 < metrics.length && occlusionStepValid(m, metrics[index + 1]!, params)) {
    return 'occlusion_pixel';
  }
  return null;
}

function meetsBodyEntryAt(
  metrics: BodyEntryFrameMetrics[],
  index: number,
  params: EventDetectionParams,
): boolean {
  return frameEntryPath(metrics, index, params) != null;
}

/** Per-frame torso + pixel entry signals (chronological samples). */
export function buildBodyEntryFrameMetrics(
  input: Omit<BodyEntryDetectionInput, 'censorFrameIndex'>,
): BodyEntryFrameMetrics[] {
  const {
    frameIndices,
    timeUsByFrame,
    platformBlobAreas,
    holeDarkenings,
    observationsByFrame,
    hole,
    platformRadiusPx,
    params,
  } = input;

  if (frameIndices.length === 0) return [];

  const earlyCount = Math.max(1, Math.ceil(frameIndices.length * 0.25));
  const earlyBaseline =
    platformBlobAreas.slice(0, earlyCount).reduce((a, b) => a + b, 0) / earlyCount;
  const areaThreshold =
    earlyBaseline > 10 ? earlyBaseline * params.bodyEntryPlatformAreaMaxFraction : Infinity;
  const torsoMaxDist = platformRadiusPx * params.bodyEntryTorsoProximityFraction;
  const approachMaxDist = platformRadiusPx * params.escapeProximityFraction;

  const base = frameIndices.map((frameIndex, i) => {
    const obs = observationAt(observationsByFrame, frameIndex);
    const bodyDistPx = obs?.bodyXY ? dist(obs.bodyXY, hole) : null;
    const meetsTorsoProximity = bodyDistPx != null && bodyDistPx <= torsoMaxDist;
    const meetsApproachProximity = bodyDistPx != null && bodyDistPx <= approachMaxDist;
    const meetsPixelTorsoEntry =
      holeDarkenings[i]! >= params.bodyEntryHoleDarkeningMin &&
      platformBlobAreas[i]! <= areaThreshold;

    return {
      frameIndex,
      timeUs: timeUsByFrame.get(frameIndex) ?? 0,
      platformBlobArea: platformBlobAreas[i]!,
      holeDarkening: holeDarkenings[i]!,
      bodyDistPx,
      meetsTorsoProximity,
      meetsApproachProximity,
      meetsPixelTorsoEntry,
      meetsPixelEntry: meetsPixelTorsoEntry,
      meetsBodyEntry: false,
      entryPath: null as BodyEntryPath,
    };
  });

  return base.map((row, index) => {
    const entryPath = frameEntryPath(base, index, params);
    return {
      ...row,
      entryPath,
      meetsBodyEntry: entryPath != null,
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
  let completionPath: BodyEntryPath = null;

  for (let start = 0; start <= metrics.length - minFrames; start += 1) {
    if (!meetsBodyEntryAt(metrics, start, input.params)) continue;
    let run = 0;
    for (let j = start; j < metrics.length; j += 1) {
      if (!meetsBodyEntryAt(metrics, j, input.params)) break;
      run += 1;
    }
    if (run >= minFrames) {
      const first = metrics[start]!;
      completionFrameIndex = first.frameIndex;
      completionTimeUs = first.timeUs;
      temporalSupportFrames = run;
      completionPath = first.entryPath;
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
      completionPath: null,
      areaDecayScore,
      failureReason: 'no_temporally_supported_body_entry',
      frameMetrics: metrics,
    };
  }

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
      completionPath: null,
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
    completionPath,
    areaDecayScore,
    failureReason: null,
    frameMetrics: metrics,
  };
}
