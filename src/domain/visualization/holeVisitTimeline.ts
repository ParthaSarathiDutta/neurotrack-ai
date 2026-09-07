import type { BehavioralEvent, EventStatus } from '../types';
import { trialRelativeSec } from './trialObservations';

export interface InvestigationSpan {
  id: string;
  holeDisplay: number;
  startSec: number;
  endSec: number;
  startFrameIndex: number;
  status: EventStatus;
  origin: 'auto' | 'manual';
  confidence: BehavioralEvent['confidence'];
  isRevisit: boolean | null;
  visitIndex: number | null;
}

export type EscapeMarkerKind =
  | 'entry_onset'
  | 'completion'
  | 'candidate_entry'
  | 'censor_boundary';

export interface EscapeMarker {
  kind: EscapeMarkerKind;
  sec: number;
  frameIndex: number;
  label: string;
  status: EventStatus | null;
  origin: 'auto' | 'manual' | null;
}

export interface HoleVisitTimelineModel {
  trialDurationSec: number;
  preTrialEndSec: number;
  censorSec: number;
  holeDisplays: number[];
  investigations: InvestigationSpan[];
  escapeMarkers: EscapeMarker[];
}

function holeDisplay(holeId: number | null): number | null {
  if (holeId == null || holeId < 0 || holeId > 19) return null;
  return holeId + 1;
}

export function buildHoleVisitTimelineModel(
  events: BehavioralEvent[],
  trialStartUs: number,
  censorUs: number,
  preTrialEndUs: number | null,
): HoleVisitTimelineModel {
  const investigations: InvestigationSpan[] = [];
  const escapeMarkers: EscapeMarker[] = [];

  for (const ev of events) {
    if (ev.type === 'investigation' && ev.status !== 'rejected' && ev.holeId != null) {
      const holeDisplayNum = holeDisplay(ev.holeId);
      if (holeDisplayNum == null) continue;
      investigations.push({
        id: ev.id,
        holeDisplay: holeDisplayNum,
        startSec: trialRelativeSec(ev.startTimeUs, trialStartUs),
        endSec: trialRelativeSec(ev.endTimeUs, trialStartUs),
        startFrameIndex: ev.startFrameIndex,
        status: ev.status,
        origin: ev.origin,
        confidence: ev.confidence,
        isRevisit: ev.isRevisit,
        visitIndex: ev.visitIndex,
      });
      continue;
    }

    if (ev.type === 'investigation') continue;

    if (ev.entryOnsetTimeUs != null) {
      escapeMarkers.push({
        kind: ev.type === 'escape_entry_uncertain' ? 'candidate_entry' : 'entry_onset',
        sec: trialRelativeSec(ev.entryOnsetTimeUs, trialStartUs),
        frameIndex: ev.startFrameIndex,
        label:
          ev.type === 'escape_entry_uncertain'
            ? 'Candidate hole entry'
            : 'Hole entry onset',
        status: ev.status,
        origin: ev.origin,
      });
    }

    if (ev.completionTimeUs != null && ev.type === 'escape_completed') {
      escapeMarkers.push({
        kind: 'completion',
        sec: trialRelativeSec(ev.completionTimeUs, trialStartUs),
        frameIndex: ev.endFrameIndex,
        label: ev.status === 'confirmed' ? 'Confirmed completion' : 'Proposed completion',
        status: ev.status,
        origin: ev.origin,
      });
    }

    if (ev.censorBoundaryTimeUs != null) {
      escapeMarkers.push({
        kind: 'censor_boundary',
        sec: trialRelativeSec(ev.censorBoundaryTimeUs, trialStartUs),
        frameIndex: ev.endFrameIndex,
        label: 'Censor boundary',
        status: ev.status,
        origin: ev.origin,
      });
    }
  }

  return {
    trialDurationSec: trialRelativeSec(censorUs, trialStartUs),
    preTrialEndSec:
      preTrialEndUs != null ? trialRelativeSec(preTrialEndUs, trialStartUs) : 0,
    censorSec: trialRelativeSec(censorUs, trialStartUs),
    holeDisplays: Array.from({ length: 20 }, (_, i) => i + 1),
    investigations,
    escapeMarkers,
  };
}
