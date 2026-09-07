import type { BehavioralEvent } from '../types';
import { formatHoleDisplayId } from '../holeDisplay';
import { formatPresentationTimeSeconds } from '../timing';
import { escapeExportLabel } from './escapeSummary';
import { confirmedTargetHoleId } from '../events/holeProximity';
import type { Geometry } from '../types';

export interface EventExportRow {
  trialId: string;
  eventId: string;
  type: string;
  exportLabel: string;
  holeDisplay: string | null;
  holeIdInternal: number | null;
  startFrameIndex: number;
  endFrameIndex: number;
  startFrameDisplay: number;
  endFrameDisplay: number;
  startTimeSec: string;
  endTimeSec: string;
  entryOnsetTimeSec: string | null;
  completionTimeSec: string | null;
  censorBoundaryTimeSec: string | null;
  origin: string;
  status: string;
  confidence: string | null;
  visitIndex: number | null;
  isRevisit: boolean | null;
  bodyEntryPath: string | null;
  bodyEntryVersion: string | null;
  pixelEvidenceComplete: string | null;
  notes: string | null;
}

function secLabel(timeUs: number | null): string | null {
  if (timeUs == null) return null;
  return formatPresentationTimeSeconds(timeUs);
}

export function buildEventExportRows(
  trialId: string,
  events: BehavioralEvent[],
  geometry: Geometry,
): EventExportRow[] {
  const targetConfirmed = confirmedTargetHoleId(geometry) != null;

  return events.map((ev) => ({
    trialId,
    eventId: ev.id,
    type: ev.type,
    exportLabel:
      ev.type === 'investigation'
        ? 'investigation'
        : escapeExportLabel(ev, targetConfirmed),
    holeDisplay: ev.holeId != null ? formatHoleDisplayId(ev.holeId) : null,
    holeIdInternal: ev.holeId,
    startFrameIndex: ev.startFrameIndex,
    endFrameIndex: ev.endFrameIndex,
    startFrameDisplay: ev.startFrameIndex + 1,
    endFrameDisplay: ev.endFrameIndex + 1,
    startTimeSec: secLabel(ev.startTimeUs) ?? '',
    endTimeSec: secLabel(ev.endTimeUs) ?? '',
    entryOnsetTimeSec: secLabel(ev.entryOnsetTimeUs),
    completionTimeSec: secLabel(ev.completionTimeUs),
    censorBoundaryTimeSec: secLabel(ev.censorBoundaryTimeUs),
    origin: ev.origin,
    status: ev.status,
    confidence: ev.confidence,
    visitIndex: ev.visitIndex,
    isRevisit: ev.isRevisit,
    bodyEntryPath:
      typeof ev.evidence.bodyEntryPath === 'string' ? ev.evidence.bodyEntryPath : null,
    bodyEntryVersion:
      typeof ev.evidence.bodyEntryDefinitionVersion === 'string'
        ? ev.evidence.bodyEntryDefinitionVersion
        : null,
    pixelEvidenceComplete:
      ev.evidence.evidenceComplete != null ? String(ev.evidence.evidenceComplete) : null,
    notes: ev.notes,
  }));
}

export const EVENT_EXPORT_COLUMNS: (keyof EventExportRow)[] = [
  'trialId',
  'eventId',
  'type',
  'exportLabel',
  'holeDisplay',
  'holeIdInternal',
  'startFrameIndex',
  'endFrameIndex',
  'startFrameDisplay',
  'endFrameDisplay',
  'startTimeSec',
  'endTimeSec',
  'entryOnsetTimeSec',
  'completionTimeSec',
  'censorBoundaryTimeSec',
  'origin',
  'status',
  'confidence',
  'visitIndex',
  'isRevisit',
  'bodyEntryPath',
  'bodyEntryVersion',
  'pixelEvidenceComplete',
  'notes',
];

export function eventRowsToObjects(rows: EventExportRow[]): Record<string, string | number | boolean | null>[] {
  return rows.map((row) => ({ ...row }));
}
