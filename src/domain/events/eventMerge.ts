import type { BehavioralEvent } from '../types';

const MERGE_FRAME_TOLERANCE = 2;

function eventKey(e: BehavioralEvent): string {
  return `${e.type}:${e.holeId ?? 'none'}:${e.startFrameIndex}`;
}

/** Merge newly detected auto events with preserved manual/confirmed/rejected reviews. */
export function mergeDetectedEvents(
  previous: BehavioralEvent[],
  detected: BehavioralEvent[],
): BehavioralEvent[] {
  const preserved = previous.filter(
    (e) => e.origin === 'manual' || e.status === 'confirmed' || e.status === 'rejected',
  );
  const preservedKeys = new Set(preserved.map(eventKey));

  const freshAuto = detected.filter((e) => {
    if (preservedKeys.has(eventKey(e))) return false;
    for (const p of preserved) {
      if (
        p.type === e.type &&
        p.holeId === e.holeId &&
        Math.abs(p.startFrameIndex - e.startFrameIndex) <= MERGE_FRAME_TOLERANCE
      ) {
        return false;
      }
    }
    return true;
  });

  return [...preserved, ...freshAuto.map((e) => ({ ...e, origin: 'auto' as const, status: 'proposed' as const }))];
}

export function isInvestigationConfirmed(e: BehavioralEvent): boolean {
  if (e.type !== 'investigation') return false;
  if (e.status === 'rejected') return false;
  if (e.status === 'confirmed' || e.origin === 'manual') return true;
  return false;
}

export function isInvestigationProvisional(e: BehavioralEvent): boolean {
  if (e.type !== 'investigation') return false;
  if (e.status === 'rejected') return false;
  if (isInvestigationConfirmed(e)) return false;
  return e.status === 'proposed';
}
