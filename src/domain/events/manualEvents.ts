import type { BehavioralEvent, EventType, TimestampIndexEntry } from '../types';

function newEventId(): string {
  return crypto.randomUUID();
}

export function timeUsForFrame(
  timestampIndex: TimestampIndexEntry[],
  frameIndex: number,
): number | null {
  return timestampIndex.find((e) => e.frameIndex === frameIndex)?.timeUs ?? null;
}

/** Recompute visitIndex / isRevisit for investigations in chronological order. */
export function reindexInvestigationVisits(events: BehavioralEvent[]): BehavioralEvent[] {
  const visitCounts = new Map<number, number>();
  return events.map((e) => {
    if (e.type !== 'investigation' || e.holeId == null) return e;
    const prev = visitCounts.get(e.holeId) ?? 0;
    const visitIndex = prev + 1;
    visitCounts.set(e.holeId, visitIndex);
    return { ...e, visitIndex, isRevisit: visitIndex > 1 };
  });
}

export function buildManualInvestigation(input: {
  holeId: number;
  startFrameIndex: number;
  endFrameIndex: number;
  timestampIndex: TimestampIndexEntry[];
  notes?: string | null;
}): BehavioralEvent | null {
  const startTimeUs = timeUsForFrame(input.timestampIndex, input.startFrameIndex);
  const endTimeUs = timeUsForFrame(input.timestampIndex, input.endFrameIndex);
  if (startTimeUs == null || endTimeUs == null) return null;
  return {
    id: newEventId(),
    type: 'investigation',
    holeId: input.holeId,
    startFrameIndex: input.startFrameIndex,
    endFrameIndex: input.endFrameIndex,
    startTimeUs,
    endTimeUs,
    entryOnsetTimeUs: null,
    completionTimeUs: null,
    censorBoundaryTimeUs: null,
    origin: 'manual',
    status: 'confirmed',
    confidence: 'medium',
    visitIndex: null,
    isRevisit: null,
    evidence: { manual: true, dwellUs: endTimeUs - startTimeUs },
    notes: input.notes ?? null,
  };
}

export function buildManualEscapeEvent(input: {
  type: Exclude<EventType, 'investigation'>;
  holeId: number | null;
  entryOnsetFrameIndex: number | null;
  timestampIndex: TimestampIndexEntry[];
  censorBoundaryTimeUs: number;
  trialStartTimeUs: number;
  notes?: string | null;
}): BehavioralEvent | null {
  const censorEntry = input.timestampIndex.find(
    (e) => e.timeUs >= input.censorBoundaryTimeUs,
  ) ?? input.timestampIndex[input.timestampIndex.length - 1];
  if (!censorEntry) return null;

  const entryTimeUs =
    input.entryOnsetFrameIndex != null
      ? timeUsForFrame(input.timestampIndex, input.entryOnsetFrameIndex)
      : null;
  const entryFrame =
    input.entryOnsetFrameIndex ?? censorEntry.frameIndex;

  return {
    id: newEventId(),
    type: input.type,
    holeId: input.holeId,
    startFrameIndex: entryFrame,
    endFrameIndex: censorEntry.frameIndex,
    startTimeUs: entryTimeUs ?? input.censorBoundaryTimeUs,
    endTimeUs: input.censorBoundaryTimeUs,
    entryOnsetTimeUs: entryTimeUs,
    completionTimeUs: input.type === 'escape_completed' ? input.censorBoundaryTimeUs : null,
    censorBoundaryTimeUs: input.censorBoundaryTimeUs,
    origin: 'manual',
    status: 'confirmed',
    confidence: 'medium',
    visitIndex: null,
    isRevisit: null,
    evidence: {
      manual: true,
      observedFollowUpLowerBoundUs: input.censorBoundaryTimeUs - input.trialStartTimeUs,
    },
    notes: input.notes ?? null,
  };
}

/** Replace auto escape/censor record while preserving investigations. */
export function replaceEscapeEvent(
  events: BehavioralEvent[],
  escape: BehavioralEvent,
): BehavioralEvent[] {
  const investigations = events.filter((e) => e.type === 'investigation');
  const preservedEscape = events.filter(
    (e) => e.type !== 'investigation' && (e.origin === 'manual' || e.status === 'confirmed'),
  );
  if (preservedEscape.length > 0 && escape.origin === 'auto') {
    return events;
  }
  return [...investigations, escape];
}

export function mergeManualEventEdit(
  events: BehavioralEvent[],
  eventId: string,
  patch: Partial<Pick<BehavioralEvent, 'holeId' | 'startFrameIndex' | 'endFrameIndex' | 'type' | 'notes' | 'status'>>,
  timestampIndex: TimestampIndexEntry[],
): BehavioralEvent[] {
  return events.map((e) => {
    if (e.id !== eventId) return e;
    const startFrameIndex = patch.startFrameIndex ?? e.startFrameIndex;
    const endFrameIndex = patch.endFrameIndex ?? e.endFrameIndex;
    const startTimeUs = timeUsForFrame(timestampIndex, startFrameIndex) ?? e.startTimeUs;
    const endTimeUs = timeUsForFrame(timestampIndex, endFrameIndex) ?? e.endTimeUs;
    return {
      ...e,
      ...patch,
      startFrameIndex,
      endFrameIndex,
      startTimeUs,
      endTimeUs,
      origin: e.origin === 'manual' ? 'manual' : 'manual',
      status: patch.status ?? (e.origin === 'manual' ? 'confirmed' : e.status),
      evidence: {
        ...e.evidence,
        manual: true,
        dwellUs: e.type === 'investigation' ? endTimeUs - startTimeUs : e.evidence.dwellUs,
      },
    };
  });
}
