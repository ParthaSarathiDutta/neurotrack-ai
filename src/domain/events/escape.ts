import type {
  BehavioralEvent,
  EventDetectionParams,
  Geometry,
  Observation,
} from '../types';
import {
  censorBoundaryTimeUs,
  dist,
  effectiveTrialStartUs,
  isInTrial,
  nearestHoleWithin,
  observationProximityToHole,
} from './holeProximity';

export interface PixelEvidenceResult {
  framesAnalyzed: number;
  framesRequested: number;
  complete: boolean;
  unavailableReason?: 'budget_exceeded' | 'frame_worker_error' | 'missing_video_cache';
  areaDecayScore: number | null;
  holeDarkeningScore: number | null;
}

export interface EscapeDetectionContext {
  pixelEvidence?: PixelEvidenceResult | null;
}

function newEventId(): string {
  return crypto.randomUUID();
}

function bodySpeedPxPerSec(a: Observation, b: Observation): number | null {
  const dt = b.timeUs - a.timeUs;
  if (dt <= 0 || !a.bodyXY || !b.bodyXY) return null;
  return dist(a.bodyXY, b.bodyXY) / (dt / 1_000_000);
}

interface PhaseACandidate {
  holeId: number;
  score: number;
  proximitySpanUs: number;
  entryOnsetTimeUs: number;
  entryOnsetFrameIndex: number;
  endFrameIndex: number;
  endTimeUs: number;
  motionDecay: number;
}

export type { PhaseACandidate };

function scorePhaseA(
  observations: Observation[],
  geometry: Geometry,
  trialStartUs: number,
  censorUs: number,
  params: EventDetectionParams,
): PhaseACandidate | null {
  const radius = geometry.platformRadiusPx;
  if (!radius || geometry.holes.length === 0) return null;

  const inTrial = observations.filter((o) => isInTrial(o, trialStartUs, censorUs));
  if (inTrial.length < 4) return null;

  const trail = inTrial.slice(-Math.min(inTrial.length, 120));
  let best: PhaseACandidate | null = null;

  for (const hole of geometry.holes) {
    let streakStart: Observation | null = null;
    let streakEnd: Observation | null = null;
    let streakUs = 0;

    for (const obs of trail) {
      const prox = observationProximityToHole(
        obs,
        hole,
        radius,
        params.escapeProximityFraction,
        params.escapeProximityFraction,
      );
      if (prox.inZone) {
        if (!streakStart) streakStart = obs;
        streakEnd = obs;
        streakUs = streakEnd.timeUs - streakStart.timeUs;
      }
    }

    if (!streakStart || !streakEnd || streakUs < params.escapeProximityMinSpanUs) continue;

    const mid = Math.floor(trail.length / 2);
    const early = trail.slice(Math.max(0, mid - 3), mid);
    const late = trail.slice(-4);
    const earlySpeeds: number[] = [];
    const lateSpeeds: number[] = [];
    for (let i = 1; i < early.length; i += 1) {
      const s = bodySpeedPxPerSec(early[i - 1]!, early[i]!);
      if (s != null) earlySpeeds.push(s);
    }
    for (let i = 1; i < late.length; i += 1) {
      const s = bodySpeedPxPerSec(late[i - 1]!, late[i]!);
      if (s != null) lateSpeeds.push(s);
    }
    const earlyMean = earlySpeeds.length
      ? earlySpeeds.reduce((a, b) => a + b, 0) / earlySpeeds.length
      : 0;
    const lateMean = lateSpeeds.length
      ? lateSpeeds.reduce((a, b) => a + b, 0) / lateSpeeds.length
      : 0;
    const motionDecay = earlyMean > 1 ? lateMean / earlyMean : 1;

    let score = 0.3;
    score += Math.min(0.4, streakUs / 2_000_000);
    if (motionDecay < params.escapeMotionDecayRatio) score += 0.25;

    const lastBody = [...trail].reverse().find((o) => o.bodyXY)?.bodyXY;
    if (lastBody) {
      const near = nearestHoleWithin(lastBody, geometry.holes, radius, params.escapeProximityFraction);
      if (near?.hole.id === hole.id) score += 0.15;
    }

    if (!best || score > best.score) {
      best = {
        holeId: hole.id,
        score,
        proximitySpanUs: streakUs,
        entryOnsetTimeUs: streakStart.timeUs,
        entryOnsetFrameIndex: streakStart.frameIndex,
        endFrameIndex: streakEnd.frameIndex,
        endTimeUs: streakEnd.timeUs,
        motionDecay,
      };
    }
  }

  return best;
}

/** Phase A trajectory gate for pixel pass and escape scoring. */
export function getPhaseACandidate(
  observations: Observation[],
  geometry: Geometry,
  trialStartUs: number,
  censorUs: number,
  params: EventDetectionParams,
): PhaseACandidate | null {
  return scorePhaseA(observations, geometry, trialStartUs, censorUs, params);
}

function hasRimProximityWithoutEntry(
  observations: Observation[],
  geometry: Geometry,
  trialStartUs: number,
  censorUs: number,
  params: EventDetectionParams,
): boolean {
  const radius = geometry.platformRadiusPx;
  if (!radius) return false;
  const trail = observations
    .filter((o) => isInTrial(o, trialStartUs, censorUs))
    .slice(-40);
  for (const obs of trail) {
    for (const hole of geometry.holes) {
      const prox = observationProximityToHole(
        obs,
        hole,
        radius,
        params.escapeProximityFraction,
        params.escapeProximityFraction,
      );
      if (prox.inZone) return true;
    }
  }
  return false;
}

function isTrackingLostAtCensor(
  observations: Observation[],
  trialStartUs: number,
  censorUs: number,
): boolean {
  const inTrial = observations.filter((o) => isInTrial(o, trialStartUs, censorUs));
  const last = inTrial[inTrial.length - 1];
  return last?.observed === 'lost';
}

/** Detect escape / censor outcome at trial end. */
export function detectEscapeOutcome(
  observations: Observation[],
  geometry: Geometry,
  trialWindow: Parameters<typeof censorBoundaryTimeUs>[0],
  timestampIndex: { timeUs: number; frameIndex: number }[],
  params: EventDetectionParams,
  ctx: EscapeDetectionContext = {},
): BehavioralEvent | null {
  const trialStart = effectiveTrialStartUs(trialWindow);
  const censorUs = censorBoundaryTimeUs(trialWindow, timestampIndex);
  if (trialStart == null || censorUs == null) return null;

  const followUpLowerBoundUs = censorUs - trialStart;
  const censorReason =
    censorUs === timestampIndex[timestampIndex.length - 1]?.timeUs
      ? 'recording_end'
      : 'protocol_cutoff';

  const phaseA = scorePhaseA(observations, geometry, trialStart, censorUs, params);
  let score = phaseA?.score ?? 0;
  let pixelComplete = true;
  let pixelFlags: Record<string, number | string | boolean | null> = {};

  if (ctx.pixelEvidence) {
    pixelComplete = ctx.pixelEvidence.complete;
    pixelFlags = {
      pixelFramesAnalyzed: ctx.pixelEvidence.framesAnalyzed,
      pixelFramesRequested: ctx.pixelEvidence.framesRequested,
      pixelEvidenceComplete: ctx.pixelEvidence.complete,
      areaDecayScore: ctx.pixelEvidence.areaDecayScore,
      holeDarkeningScore: ctx.pixelEvidence.holeDarkeningScore,
    };
    if (ctx.pixelEvidence.areaDecayScore != null) {
      score += ctx.pixelEvidence.areaDecayScore * 0.2;
    }
    if (ctx.pixelEvidence.holeDarkeningScore != null) {
      score += ctx.pixelEvidence.holeDarkeningScore * 0.1;
    }
    if (!pixelComplete) {
      score *= 0.85;
    }
  }

  const canComplete =
    pixelComplete &&
    score >= params.escapeConfirmThreshold &&
    (ctx.pixelEvidence?.areaDecayScore ?? 0) >= params.escapeCompletionAreaRatio;

  if (canComplete && phaseA) {
    return {
      id: newEventId(),
      type: 'escape_completed',
      holeId: phaseA.holeId,
      startFrameIndex: phaseA.entryOnsetFrameIndex,
      endFrameIndex: phaseA.endFrameIndex,
      startTimeUs: phaseA.entryOnsetTimeUs,
      endTimeUs: censorUs,
      entryOnsetTimeUs: phaseA.entryOnsetTimeUs,
      completionTimeUs: censorUs,
      censorBoundaryTimeUs: censorUs,
      origin: 'auto',
      status: 'proposed',
      confidence: 'high',
      visitIndex: null,
      isRevisit: null,
      evidence: {
        phaseAScore: phaseA.score,
        motionDecay: phaseA.motionDecay,
        proximitySpanUs: phaseA.proximitySpanUs,
        censorReason,
        observedFollowUpLowerBoundUs: followUpLowerBoundUs,
        ...pixelFlags,
      },
      notes: null,
    };
  }

  if (phaseA) {
    const confidence: 'medium' | 'low' =
      score >= params.escapeCensorThreshold && pixelComplete
        ? 'medium'
        : 'low';
    return {
      id: newEventId(),
      type: 'escape_incomplete_censored',
      holeId: phaseA.holeId,
      startFrameIndex: phaseA.entryOnsetFrameIndex,
      endFrameIndex: phaseA.endFrameIndex,
      startTimeUs: phaseA.entryOnsetTimeUs,
      endTimeUs: censorUs,
      entryOnsetTimeUs: phaseA.entryOnsetTimeUs,
      completionTimeUs: null,
      censorBoundaryTimeUs: censorUs,
      origin: 'auto',
      status: 'proposed',
      confidence,
      visitIndex: null,
      isRevisit: null,
      evidence: {
        phaseAScore: phaseA.score,
        motionDecay: phaseA.motionDecay,
        proximitySpanUs: phaseA.proximitySpanUs,
        censorReason,
        observedFollowUpLowerBoundUs: followUpLowerBoundUs,
        ...(pixelComplete ? {} : { pixel_evidence_incomplete: true }),
        ...pixelFlags,
      },
      notes: null,
    };
  }

  // Insufficient entry evidence — distinguish rim exploration vs trial censor vs no record
  if (isTrackingLostAtCensor(observations, trialStart, censorUs)) {
    return null;
  }
  if (hasRimProximityWithoutEntry(observations, geometry, trialStart, censorUs, params)) {
    return null;
  }
  return {
      id: newEventId(),
      type: 'trial_censored_no_entry',
      holeId: null,
      startFrameIndex: timestampIndex[timestampIndex.length - 1]?.frameIndex ?? 0,
      endFrameIndex: timestampIndex[timestampIndex.length - 1]?.frameIndex ?? 0,
      startTimeUs: censorUs,
      endTimeUs: censorUs,
      entryOnsetTimeUs: null,
      completionTimeUs: null,
      censorBoundaryTimeUs: censorUs,
      origin: 'auto',
      status: 'proposed',
      confidence: null,
      visitIndex: null,
      isRevisit: null,
      evidence: {
        phaseAScore: 0,
        censorReason,
        observedFollowUpLowerBoundUs: followUpLowerBoundUs,
        no_entry_evidence: true,
        ...pixelFlags,
      },
      notes: null,
    };
}
