import type { BehavioralEvent, ErrorCountBucket, ErrorCounts, Geometry } from '../types';
import { confirmedTargetHoleId } from '../events/holeProximity';
import { isInvestigationConfirmed, isInvestigationProvisional } from '../events/eventMerge';

function emptyBucket(): ErrorCountBucket {
  return { total: 0, distinctHoleCount: 0, revisitCount: 0 };
}

function accumulateErrors(
  events: BehavioralEvent[],
  targetId: number | null,
  beforeTimeUs: number,
  filter: (e: BehavioralEvent) => boolean,
): ErrorCountBucket {
  const bucket = emptyBucket();
  if (targetId == null) return bucket;

  const holeVisits = new Map<number, number>();
  const distinctHoles = new Set<number>();

  for (const e of events) {
    if (e.type !== 'investigation' || e.holeId == null) continue;
    if (e.holeId === targetId) continue;
    if (e.startTimeUs >= beforeTimeUs) continue;
    if (!filter(e)) continue;

    const visits = (holeVisits.get(e.holeId) ?? 0) + 1;
    holeVisits.set(e.holeId, visits);
    if (visits === 1) {
      distinctHoles.add(e.holeId);
    } else {
      bucket.revisitCount += 1;
    }
    bucket.total += 1;
  }

  bucket.distinctHoleCount = distinctHoles.size;
  return bucket;
}

export function computeErrorCounts(
  events: BehavioralEvent[],
  geometry: Geometry,
  firstTargetInvestigationTimeUs: number | null,
  censorUs: number,
): ErrorCounts {
  const targetId = confirmedTargetHoleId(geometry);
  const primaryBoundary = firstTargetInvestigationTimeUs ?? censorUs;

  return {
    confirmed: accumulateErrors(events, targetId, primaryBoundary, isInvestigationConfirmed),
    provisional: accumulateErrors(events, targetId, primaryBoundary, isInvestigationProvisional),
  };
}

export function computeTotalErrorCounts(
  events: BehavioralEvent[],
  geometry: Geometry,
  censorUs: number,
): ErrorCounts {
  const targetId = confirmedTargetHoleId(geometry);
  return {
    confirmed: accumulateErrors(events, targetId, censorUs, isInvestigationConfirmed),
    provisional: accumulateErrors(events, targetId, censorUs, isInvestigationProvisional),
  };
}
