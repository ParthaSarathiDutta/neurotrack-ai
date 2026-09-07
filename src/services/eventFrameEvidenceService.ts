import { buildBackgroundModel, sampleBackgroundFrameIndices } from '../domain/tracking/background';
import {
  aggregatePixelEvidenceScores,
  selectPixelEvidenceFrameIndices,
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
  Geometry,
  Observation,
  TrialRecord,
  TrialWindow,
} from '../domain/types';
import {
  getActiveDecoderFingerprint,
  getMultipleFramePixels,
  initFrameDecoder,
} from './frameService';

const BACKGROUND_SAMPLE_COUNT = 20;

export interface FetchPixelEvidenceInput {
  trial: TrialRecord;
  observations: Observation[];
  geometry: Geometry;
  trialWindow: TrialWindow;
  params: EventDetectionParams;
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

  try {
    if (getActiveDecoderFingerprint() !== trial.fingerprint) {
      await initFrameDecoder(trial.fingerprint);
    }
  } catch {
    return {
      framesAnalyzed: 0,
      framesRequested: 0,
      complete: false,
      unavailableReason: 'missing_video_cache',
      areaDecayScore: null,
      holeDarkeningScore: null,
    };
  }

  const budget = params.pixelEvidenceBudgetFrames;
  const requestedIndices = selectPixelEvidenceFrameIndices(
    trial.timestampIndex,
    phaseA.entryOnsetFrameIndex,
    trial.timestampIndex[trial.timestampIndex.length - 1]!.frameIndex,
    budget,
  );
  const framesRequested = requestedIndices.length;
  const complete = requestedIndices.length <= budget;

  let bgIndices: number[] = [];
  try {
    bgIndices = sampleBackgroundFrameIndices(
      trial.timestampIndex,
      trialStart,
      censorUs,
      BACKGROUND_SAMPLE_COUNT,
    );
    const bgPixels = await getMultipleFramePixels(bgIndices, trial.fingerprint);
    const evidenceIndices = requestedIndices.slice(-budget);
    const evidencePixels = await getMultipleFramePixels(evidenceIndices, trial.fingerprint);
    const width = evidencePixels[0]?.width ?? trial.metadata?.codedWidth ?? 640;
    const height = evidencePixels[0]?.height ?? trial.metadata?.codedHeight ?? 480;

    const bgFrames = bgPixels.map((f) => f.data);
    const background = buildBackgroundModel(bgFrames, width, height);

    const samples: PixelFrameSample[] = evidencePixels.map((f) => {
      const entry = trial.timestampIndex.find((e) => e.frameIndex === f.frameIndex);
      return {
        frameIndex: f.frameIndex,
        timeUs: entry?.timeUs ?? 0,
        data: f.data,
      };
    });

    const scores = aggregatePixelEvidenceScores(
      samples,
      background,
      width,
      height,
      hole,
      center,
      radius,
    );

    return {
      framesAnalyzed: samples.length,
      framesRequested,
      complete: complete && samples.length === framesRequested,
      areaDecayScore: scores.areaDecayScore,
      holeDarkeningScore: scores.holeDarkeningScore,
    };
  } catch {
    return {
      framesAnalyzed: 0,
      framesRequested,
      complete: false,
      unavailableReason: 'frame_worker_error',
      areaDecayScore: null,
      holeDarkeningScore: null,
    };
  }
}
