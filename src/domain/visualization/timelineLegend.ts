import type { HoleVisitTimelineModel, InvestigationSpan, EscapeMarkerKind } from './holeVisitTimeline';

export type TimelineLegendKind =
  | 'confirmed_investigation'
  | 'proposed_investigation'
  | 'manual_provenance'
  | 'entry_onset'
  | 'confirmed_completion'
  | 'candidate_entry'
  | 'censor_region'
  | 'pre_trial_region';

const ALL_LEGEND_KINDS: TimelineLegendKind[] = [
  'confirmed_investigation',
  'proposed_investigation',
  'manual_provenance',
  'entry_onset',
  'confirmed_completion',
  'candidate_entry',
  'pre_trial_region',
  'censor_region',
];

const LEGEND_LABELS: Record<TimelineLegendKind, string> = {
  confirmed_investigation: 'Confirmed investigation (solid bar)',
  proposed_investigation: 'Proposed investigation (hatched bar)',
  manual_provenance: 'Manual provenance (blue outline overlay)',
  entry_onset: 'Hole entry onset (thin dashed marker)',
  confirmed_completion: 'Confirmed body-entry completion (solid marker + triangle)',
  candidate_entry: 'Candidate entry evidence (orange dashed marker — not confirmed escape)',
  pre_trial_region: 'Pre-trial shaded region',
  censor_region: 'Post-censor / trial-end boundary',
};

export interface TimelineLegendResolution {
  present: TimelineLegendKind[];
  absent: TimelineLegendKind[];
  labels: Record<TimelineLegendKind, string>;
}

function hasMarkerKind(markers: { kind: EscapeMarkerKind }[], kind: EscapeMarkerKind): boolean {
  return markers.some((m) => m.kind === kind);
}

/** Resolve which legend categories appear in the current trial data. */
export function resolveTimelineLegend(
  model: HoleVisitTimelineModel,
  investigations: InvestigationSpan[],
): TimelineLegendResolution {
  const present = new Set<TimelineLegendKind>();

  if (investigations.some((i) => i.status === 'confirmed')) {
    present.add('confirmed_investigation');
  }
  if (investigations.some((i) => i.status === 'proposed')) {
    present.add('proposed_investigation');
  }
  if (investigations.some((i) => i.origin === 'manual')) {
    present.add('manual_provenance');
  }
  if (hasMarkerKind(model.escapeMarkers, 'entry_onset')) {
    present.add('entry_onset');
  }
  if (hasMarkerKind(model.escapeMarkers, 'completion')) {
    present.add('confirmed_completion');
  }
  if (hasMarkerKind(model.escapeMarkers, 'candidate_entry')) {
    present.add('candidate_entry');
  }
  if (model.preTrialEndSec > 0.001) {
    present.add('pre_trial_region');
  }
  if (model.censorSec <= model.trialDurationSec + 0.001) {
    present.add('censor_region');
  }

  const presentList = ALL_LEGEND_KINDS.filter((k) => present.has(k));
  const absentList = ALL_LEGEND_KINDS.filter((k) => !present.has(k));

  return { present: presentList, absent: absentList, labels: LEGEND_LABELS };
}

const LEGEND_ABSENT_LABELS: Record<TimelineLegendKind, string> = {
  confirmed_investigation: 'Confirmed investigation',
  proposed_investigation: 'Proposed investigation',
  manual_provenance: 'Manual provenance',
  entry_onset: 'Entry onset',
  confirmed_completion: 'Confirmed completion',
  candidate_entry: 'Candidate entry',
  pre_trial_region: 'Pre-trial region',
  censor_region: 'Censor boundary',
};

export { LEGEND_LABELS, LEGEND_ABSENT_LABELS };
