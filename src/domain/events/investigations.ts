import type {
  BehavioralEvent,
  EventConfidence,
  EventDetectionParams,
  Geometry,
  Observation,
} from '../types';
import {
  isInTrial,
  observationProximityToHole,
  effectiveTrialStartUs,
  censorBoundaryTimeUs,
} from './holeProximity';

interface ZoneSegment {
  holeId: number;
  startFrameIndex: number;
  endFrameIndex: number;
  startTimeUs: number;
  endTimeUs: number;
  dwellUs: number;
  basis: 'nose' | 'body';
  hasAmbiguousHeadTail: boolean;
  hasLostOrLow: boolean;
}

function newEventId(): string {
  return crypto.randomUUID();
}

function confidenceForSegment(seg: ZoneSegment): EventConfidence {
  if (seg.basis === 'nose' && !seg.hasAmbiguousHeadTail && !seg.hasLostOrLow) return 'high';
  if (seg.basis === 'nose') return 'medium';
  if (!seg.hasLostOrLow) return 'medium';
  return 'low';
}

/** Detect hole investigation events from trajectory observations. */
export function detectInvestigations(
  observations: Observation[],
  geometry: Geometry,
  trialWindow: Parameters<typeof censorBoundaryTimeUs>[0],
  timestampIndex: { timeUs: number }[],
  params: EventDetectionParams,
): BehavioralEvent[] {
  const radius = geometry.platformRadiusPx;
  const holes = geometry.holes;
  if (!radius || holes.length === 0) return [];

  const trialStart = effectiveTrialStartUs(trialWindow);
  const censorUs = censorBoundaryTimeUs(trialWindow, timestampIndex);
  if (trialStart == null || censorUs == null) return [];

  const inTrial = observations.filter((o) => isInTrial(o, trialStart, censorUs));
  const segments: ZoneSegment[] = [];
  let current: ZoneSegment | null = null;

  for (const obs of inTrial) {
    let bestHole: number | null = null;
    let bestBasis: 'nose' | 'body' | null = null;
    let bestDist: number | null = null;

    for (const hole of holes) {
      const prox = observationProximityToHole(
        obs,
        hole,
        radius,
        params.investigationNoseProximityFraction,
        params.investigationBodyProximityFraction,
      );
      if (prox.inZone && (bestDist == null || (prox.distance ?? Infinity) < bestDist)) {
        bestHole = hole.id;
        bestBasis = prox.basis;
        bestDist = prox.distance;
      }
    }

    if (bestHole != null && bestBasis != null) {
      if (
        current &&
        current.holeId === bestHole &&
        (current.endFrameIndex === obs.frameIndex - 1 ||
          obs.timeUs - current.endTimeUs <= params.investigationMergeGapUs)
      ) {
        current.endFrameIndex = obs.frameIndex;
        current.endTimeUs = obs.timeUs;
        current.dwellUs = current.endTimeUs - current.startTimeUs;
        if (obs.qualityFlags?.includes('ambiguous_head_tail')) current.hasAmbiguousHeadTail = true;
        if (obs.observed === 'lost' || obs.qualityFlags?.includes('low_confidence')) {
          current.hasLostOrLow = true;
        }
      } else if (
        current &&
        current.holeId === bestHole &&
        obs.timeUs - current.endTimeUs <= params.investigationMergeGapUs
      ) {
        current.endFrameIndex = obs.frameIndex;
        current.endTimeUs = obs.timeUs;
        current.dwellUs = current.endTimeUs - current.startTimeUs;
      } else {
        if (current && current.dwellUs >= params.investigationMinDwellUs) {
          segments.push(current);
        }
        current = {
          holeId: bestHole,
          startFrameIndex: obs.frameIndex,
          endFrameIndex: obs.frameIndex,
          startTimeUs: obs.timeUs,
          endTimeUs: obs.timeUs,
          dwellUs: 0,
          basis: bestBasis,
          hasAmbiguousHeadTail: Boolean(obs.qualityFlags?.includes('ambiguous_head_tail')),
          hasLostOrLow:
            obs.observed === 'lost' || Boolean(obs.qualityFlags?.includes('low_confidence')),
        };
      }
    } else if (current) {
      const gapUs = obs.timeUs - current.endTimeUs;
      if (gapUs > params.investigationMergeGapUs) {
        if (current.dwellUs >= params.investigationMinDwellUs) segments.push(current);
        current = null;
      }
    }
  }
  if (current && current.dwellUs >= params.investigationMinDwellUs) segments.push(current);

  const visitCounts = new Map<number, number>();
  const events: BehavioralEvent[] = [];

  for (const seg of segments) {
    const prev = visitCounts.get(seg.holeId) ?? 0;
    const visitIndex = prev + 1;
    visitCounts.set(seg.holeId, visitIndex);
    const confidence = confidenceForSegment(seg);
    events.push({
      id: newEventId(),
      type: 'investigation',
      holeId: seg.holeId,
      startFrameIndex: seg.startFrameIndex,
      endFrameIndex: seg.endFrameIndex,
      startTimeUs: seg.startTimeUs,
      endTimeUs: seg.endTimeUs,
      entryOnsetTimeUs: null,
      completionTimeUs: null,
      censorBoundaryTimeUs: null,
      origin: 'auto',
      status: 'proposed',
      confidence,
      visitIndex,
      isRevisit: visitIndex > 1,
      evidence: {
        dwellUs: seg.dwellUs,
        proximityBasis: seg.basis,
      },
      notes: null,
    });
  }

  return events;
}
