import { buildBackgroundModel, sampleBackgroundFrameIndices } from '../domain/tracking/background';
import {
  aggregatePixelEvidenceScores,
  type PixelFrameSample,
} from '../domain/events/pixelEvidence';
import { getPhaseACandidate } from '../domain/events/escape';
import type { PixelEvidenceResult } from '../domain/events/escape';
import {
  censorBoundaryTimeUs,
  effectiveTrialStartUs,
} from '../domain/events/holeProximity';
import type {
  EventDetectionParams,
  Observation,
  TrialRecord,
  TrialWindow,
} from '../domain/types';
import {
  ensureFrameDecoder,
  getFramePixels,
} from './frameService';

const BACKGROUND_SAMPLE_COUNT = 20;
const DECODER_MAX_ATTEMPTS = 3;

export interface FetchPixelEvidenceInput {
  trial: TrialRecord;
  observations: Observation[];
  geometry: Parameters<typeof getPhaseACandidate>[1];
  trialWindow: TrialWindow;
  params: EventDetectionParams;
}

function unavailableResult(
  partial: Pick<PixelEvidenceResult, 'framesRequested' | 'unavailableReason' | 'errorMessage'>,
): PixelEvidenceResult {
  return {
    framesAnalyzed: 0,
    framesRequested: partial.framesRequested,
    complete: false,
    unavailableReason: partial.unavailableReason,
    areaDecayScore: null,
    holeDarkeningScore: null,
    analyzedFrameIndices: [],
    failedFrameIndices: [],
    errorMessage: partial.errorMessage ?? null,
  };
}

/** Trailing-first: try presentation-order indices from censor backward; skip undecodable frames. */
async function fetchTrailingEvidenceFrames(
  trial: TrialRecord,
  candidateIndices: number[],
  budget: number,
): Promise<{
  samples: PixelFrameSample[];
  analyzedFrameIndices: number[];
  failedFrameIndices: number[];
  lastError: string | null;
}> {
  const samples: PixelFrameSample[] = [];
  const analyzedFrameIndices: number[] = [];
  const failedFrameIndices: number[] = [];
  let lastError: string | null = null;

  const trailingFirst = [...candidateIndices].sort((a, b) => b - a);
  for (const frameIndex of trailingFirst) {
    if (samples.length >= budget) break;
    try {
      const frame = await getFramePixels(frameIndex, trial.fingerprint);
      const entry = trial.timestampIndex.find((e) => e.frameIndex === frameIndex);
      samples.push({
        frameIndex,
        timeUs: entry?.timeUs ?? 0,
        data: frame.data,
      });
      analyzedFrameIndices.push(frameIndex);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      failedFrameIndices.push(frameIndex);
    }
  }

  samples.sort((a, b) => a.frameIndex - b.frameIndex);
  analyzedFrameIndices.sort((a, b) => a - b);
  return { samples, analyzedFrameIndices, failedFrameIndices, lastError };
}

/** Bounded Phase B pixel pass via frame-worker; trailing-first within budget. */
export async function fetchEscapePixelEvidence(
  input: FetchPixelEvidenceInput,
): Promise<PixelEvidenceResult | null> {
  const { trial, observations, geometry, trialWindow, params } = input;
  const radius = geometry.platformRadiusPx;
  const center = geometry.platformCenter;
  if (!radius || !center || !trial.videoCached) return null;

  const trialStart = effectiveTrialStartUs(trialWindow);
  const censorUs = censorBoundaryTimeUs(trialWindow, trial.timestampIndex);
  if (trialStart == null || censorUs == null) return null;

  const phaseA = getPhaseACandidate(observations, geometry, trialStart, censorUs, params);
  if (!phaseA || phaseA.proximitySpanUs < params.escapeProximityMinSpanUs) {
    return null;
  }

  const hole = geometry.holes.find((h) => h.id === phaseA.holeId);
  if (!hole) return null;

  const lastFrameIndex = trial.timestampIndex[trial.timestampIndex.length - 1]?.frameIndex;
  if (lastFrameIndex == null) {
    return unavailableResult({
      framesRequested: 0,
      unavailableReason: 'frame_worker_error',
      errorMessage: 'Missing timestamp index',
    });
  }

  const budget = params.pixelEvidenceBudgetFrames;
  const inRangeCount = trial.timestampIndex.filter(
    (e) => e.frameIndex >= phaseA.entryOnsetFrameIndex && e.frameIndex <= lastFrameIndex,
  ).length;
  const framesRequested = Math.min(inRangeCount, budget);
  const truncated = inRangeCount > budget;

  try {
    await ensureFrameDecoder(trial.fingerprint, DECODER_MAX_ATTEMPTS);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return unavailableResult({
      framesRequested,
      unavailableReason: msg.includes('cache') ? 'missing_video_cache' : 'init_superseded',
      errorMessage: msg,
    });
  }

  const bgIndices = sampleBackgroundFrameIndices(
    trial.timestampIndex,
    trialStart,
    censorUs,
    BACKGROUND_SAMPLE_COUNT,
  );
  if (bgIndices.length === 0) {
    return unavailableResult({
      framesRequested,
      unavailableReason: 'frame_worker_error',
      errorMessage: 'No background sample frames in trial window',
    });
  }

  try {
    const bgSamples: PixelFrameSample[] = [];
    for (const idx of bgIndices) {
      try {
        const frame = await getFramePixels(idx, trial.fingerprint);
        const entry = trial.timestampIndex.find((e) => e.frameIndex === idx);
        bgSamples.push({ frameIndex: idx, timeUs: entry?.timeUs ?? 0, data: frame.data });
      } catch {
        // Background uses best-effort single frames; continue with those available.
      }
    }
    if (bgSamples.length === 0) {
      return unavailableResult({
        framesRequested,
        unavailableReason: 'frame_worker_error',
        errorMessage: 'Background frame decode failed',
      });
    }

    const width = trial.metadata?.codedWidth ?? 640;
    const height = trial.metadata?.codedHeight ?? 480;
    const background = buildBackgroundModel(
      bgSamples.map((s) => s.data),
      width,
      height,
    );

    const allCandidates = trial.timestampIndex
      .filter(
        (e) => e.frameIndex >= phaseA.entryOnsetFrameIndex && e.frameIndex <= lastFrameIndex,
      )
      .map((e) => e.frameIndex);

    const {
      samples,
      analyzedFrameIndices,
      failedFrameIndices,
      lastError,
    } = await fetchTrailingEvidenceFrames(trial, allCandidates, budget);

    if (samples.length === 0) {
      return unavailableResult({
        framesRequested,
        unavailableReason: 'frame_worker_error',
        errorMessage: lastError ?? 'All evidence frame decodes failed',
      });
    }

    const scores = aggregatePixelEvidenceScores(
      samples,
      background,
      width,
      height,
      hole,
      center,
      radius,
    );

    const complete =
      failedFrameIndices.length === 0 &&
      samples.length >= framesRequested &&
      !truncated;

    return {
      framesAnalyzed: samples.length,
      framesRequested,
      complete,
      areaDecayScore: scores.areaDecayScore,
      holeDarkeningScore: scores.holeDarkeningScore,
      analyzedFrameIndices,
      failedFrameIndices,
      errorMessage: complete ? null : lastError,
      ...(complete
        ? {}
        : {
            unavailableReason: truncated
              ? ('budget_exceeded' as const)
              : ('frame_worker_error' as const),
          }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return unavailableResult({
      framesRequested,
      unavailableReason: 'frame_worker_error',
      errorMessage: msg,
    });
  }
}
