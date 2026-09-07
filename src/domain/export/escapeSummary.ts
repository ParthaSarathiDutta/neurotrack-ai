import type { BehavioralEvent, MeasuresSnapshot } from '../types';
import { formatPresentationTimeSeconds } from '../timing';

export function escapeEventFromList(events: BehavioralEvent[]): BehavioralEvent | null {
  return (
    events.find(
      (e) =>
        e.type === 'escape_completed' ||
        e.type === 'escape_entry_uncertain' ||
        e.type === 'escape_incomplete_censored' ||
        e.type === 'trial_censored_no_entry',
    ) ?? null
  );
}

export function escapeStateSummary(
  escapeEv: BehavioralEvent,
  measures: MeasuresSnapshot | null | undefined,
  trialStartUs: number | null,
  targetConfirmed: boolean,
): string {
  const trialStart = trialStartUs ?? 0;
  const lowerBoundSuffix =
    escapeEv.evidence.observedFollowUpLowerBoundUs != null
      ? ` — follow-up lower bound ≥ ${formatPresentationTimeSeconds(Number(escapeEv.evidence.observedFollowUpLowerBoundUs))} s`
      : '';

  if (escapeEv.type === 'escape_completed' && escapeEv.status === 'confirmed' && escapeEv.completionTimeUs != null) {
    const completionOffsetSec = formatPresentationTimeSeconds(escapeEv.completionTimeUs - trialStart);
    const latency =
      measures?.totalLatency && !measures.totalLatency.censored && measures.totalLatency.value != null
        ? `${measures.totalLatency.value.toFixed(2)} s total latency`
        : null;
    const targetNote = targetConfirmed
      ? ''
      : ' — candidate hole completion; protocol target not confirmed';
    return `Completion at ${completionOffsetSec} s${latency ? `; ${latency}` : ''}${targetNote}`;
  }

  if (escapeEv.type === 'escape_completed' && escapeEv.completionTimeUs != null) {
    const completionOffsetSec = formatPresentationTimeSeconds(escapeEv.completionTimeUs - trialStart);
    return `Proposed completion at ${completionOffsetSec} s (frame ${escapeEv.endFrameIndex + 1}) — confirm to finalize latency`;
  }

  if (escapeEv.type === 'escape_entry_uncertain') {
    return `Candidate hole entry — not confirmed escape through protocol target${lowerBoundSuffix}`;
  }

  if (escapeEv.type === 'escape_incomplete_censored' || escapeEv.type === 'trial_censored_no_entry') {
    return `Censored outcome${lowerBoundSuffix}`;
  }

  return lowerBoundSuffix ? lowerBoundSuffix.slice(3) : '';
}

export function escapeExportLabel(escapeEv: BehavioralEvent, targetConfirmed: boolean): string {
  if (escapeEv.type === 'escape_entry_uncertain') {
    return 'candidate_hole_entry_not_protocol_escape';
  }
  if (escapeEv.type === 'escape_completed' && escapeEv.status === 'confirmed') {
    return targetConfirmed ? 'escape_completed_confirmed' : 'escape_completed_confirmed_candidate_hole';
  }
  if (escapeEv.type === 'escape_completed' && escapeEv.status === 'proposed') {
    return 'escape_completed_proposed';
  }
  return escapeEv.type;
}
