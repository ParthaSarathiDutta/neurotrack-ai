/**
 * NeuroTrack default body-entry completion (definition v3).
 * @see reference/neurotrack-body-entry-v3.md
 */
import { dist } from './holeProximity';
import type { EventDetectionParams, Hole, Observation } from '../types';

export const BODY_ENTRY_DEFINITION_ID = 'neurotrack_body_entry';
export const BODY_ENTRY_DEFINITION_VERSION = '3';

export type BodyEntryPath = 'centroid_pixel' | 'occlusion_pixel' | null;

export interface BodyEntryFrameMetrics {
  frameIndex: number;
  timeUs: number;
  platformBlobArea: number;
  holeDarkening: number;
  bodyDistPx: number | null;
  /** Strict 6% centroid gate — required for auto completion (Path A). */
  meetsTorsoProximity: boolean;
  /** Phase-A approach zone (12% radius). */
  meetsApproachProximity: boolean;
  /** Hole darkening + reduced platform remnant. */
  meetsPixelTorsoEntry: boolean;
  /** @deprecated alias */ meetsPixelEntry: boolean;
  meetsBodyEntry: boolean;
  entryPath: BodyEntryPath;
}

export interface BodyEntryCompletionResult {
  /** Path A: auto completion timestamp permitted. */
  completionEstablished: boolean;
  completionFrameIndex: number | null;
  completionTimeUs: number | null;
  completionTemporalSupportFrames: number;
  completionPath: BodyEntryPath;
  /** Path B: progressive/partial entry evidence — not auto-completion proof. */
  possibleEntryEvidence: boolean;
  possibleEntryFrameIndex: number | null;
  possibleEntryTimeUs: number | null;
  possibleEntryTemporalSupportFrames: number;
  /** @deprecated use completionEstablished */ established: boolean;
  /** @deprecated alias */ temporalSupportFrames: number;
  definitionId: string;
  definitionVersion: string;
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

function qualifiesAtPath(
  metrics: BodyEntryFrameMetrics[],
  index: number,
  params: EventDetectionParams,
  path: Exclude<BodyEntryPath, null>,
): boolean {
  return frameEntryPath(metrics, index, params) === path;
}

function findFirstRun(
  metrics: BodyEntryFrameMetrics[],
  params: EventDetectionParams,
  path: Exclude<BodyEntryPath, null>,
  minFrames: number,
): { startIndex: number; length: number } | null {
  for (let start = 0; start <= metrics.length - minFrames; start += 1) {
    if (!qualifiesAtPath(metrics, start, params, path)) continue;
    let run = 0;
    for (let j = start; j < metrics.length; j += 1) {
      if (!qualifiesAtPath(metrics, j, params, path)) break;
      run += 1;
    }
    if (run >= minFrames) return { startIndex: start, length: run };
  }
  return null;
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

function recordingEndGuard(
  metrics: BodyEntryFrameMetrics[],
  startIndex: number,
  runLength: number,
  censorFrameIndex: number,
): boolean {
  const first = metrics[startIndex]!;
  return (
    first.frameIndex === censorFrameIndex &&
    runLength === 1 &&
    metrics.length > 1
  );
}

/**
 * Path A may establish auto completion; Path B is possible-entry evidence only.
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
  const completionRun = findFirstRun(metrics, input.params, 'centroid_pixel', minFrames);
  const possibleRun = findFirstRun(metrics, input.params, 'occlusion_pixel', minFrames);

  let completionEstablished = false;
  let completionFrameIndex: number | null = null;
  let completionTimeUs: number | null = null;
  let completionTemporalSupportFrames = 0;

  if (
    completionRun &&
    !recordingEndGuard(metrics, completionRun.startIndex, completionRun.length, input.censorFrameIndex)
  ) {
    const first = metrics[completionRun.startIndex]!;
    completionEstablished = true;
    completionFrameIndex = first.frameIndex;
    completionTimeUs = first.timeUs;
    completionTemporalSupportFrames = completionRun.length;
  }

  let possibleEntryEvidence = false;
  let possibleEntryFrameIndex: number | null = null;
  let possibleEntryTimeUs: number | null = null;
  let possibleEntryTemporalSupportFrames = 0;

  if (
    possibleRun &&
    !recordingEndGuard(metrics, possibleRun.startIndex, possibleRun.length, input.censorFrameIndex)
  ) {
    const first = metrics[possibleRun.startIndex]!;
    possibleEntryEvidence = true;
    possibleEntryFrameIndex = first.frameIndex;
    possibleEntryTimeUs = first.timeUs;
    possibleEntryTemporalSupportFrames = possibleRun.length;
  }

  let failureReason: string | null = null;
  if (!completionEstablished && !possibleEntryEvidence) {
    failureReason = 'no_temporally_supported_body_entry';
  } else if (!completionEstablished && possibleEntryEvidence) {
    failureReason = 'possible_entry_only_occlusion_path';
  }

  return {
    completionEstablished,
    completionFrameIndex,
    completionTimeUs,
    completionTemporalSupportFrames,
    completionPath: completionEstablished ? 'centroid_pixel' : null,
    possibleEntryEvidence,
    possibleEntryFrameIndex,
    possibleEntryTimeUs,
    possibleEntryTemporalSupportFrames,
    established: completionEstablished,
    temporalSupportFrames: completionTemporalSupportFrames,
    definitionId: BODY_ENTRY_DEFINITION_ID,
    definitionVersion: BODY_ENTRY_DEFINITION_VERSION,
    areaDecayScore,
    failureReason,
    frameMetrics: metrics,
  };
}
