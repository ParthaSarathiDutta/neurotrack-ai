import type { AnalysisParams } from '../types';
import { BODY_ENTRY_DEFINITION_ID, BODY_ENTRY_DEFINITION_VERSION } from '../events/bodyEntry';
import { EVENT_STRATEGY_CLASSIFIER_VERSION } from '../constants';

export interface OperationalDefinitionRow {
  definitionId: string;
  definitionVersion: string;
  definitionLabel: string;
  definitionSummary: string;
  selectedVariant: string;
  notes: string | null;
}

export function buildOperationalDefinitionRows(params: AnalysisParams): OperationalDefinitionRow[] {
  const op = params.operationalDefinitions;
  return [
    {
      definitionId: 'primary_latency.v1',
      definitionVersion: '1',
      definitionLabel: 'Primary latency',
      definitionSummary: 'Time to first target visit per selected variant',
      selectedVariant: op.primaryLatencyVariant,
      notes: null,
    },
    {
      definitionId: 'total_latency.v1',
      definitionVersion: '1',
      definitionLabel: 'Total latency',
      definitionSummary: 'Protocol completion time (confirmed escape completion)',
      selectedVariant: 'protocol_completion_time',
      notes: 'Proposed auto completions remain censored until confirmed',
    },
    {
      definitionId: 'primary_errors.v1',
      definitionVersion: '1',
      definitionLabel: 'Primary errors',
      definitionSummary: 'Confirmed non-target investigations before first target visit',
      selectedVariant: 'confirmed_investigations',
      notes: 'Provisional counts exported separately in summary row',
    },
    {
      definitionId: 'total_errors.v1',
      definitionVersion: '1',
      definitionLabel: 'Total errors',
      definitionSummary: 'Confirmed non-target investigations before censor boundary',
      selectedVariant: 'confirmed_investigations',
      notes: null,
    },
    {
      definitionId: 'path_length.v1',
      definitionVersion: '1',
      definitionLabel: 'Path length',
      definitionSummary: 'Sum of body displacements (D12)',
      selectedVariant: 'spatial_sum_valid_intervals',
      notes: null,
    },
    {
      definitionId: 'mean_speed.v1',
      definitionVersion: '1',
      definitionLabel: 'Mean speed',
      definitionSummary: 'Time-weighted mean over valid intervals',
      selectedVariant: 'time_weighted_mean',
      notes: null,
    },
    {
      definitionId: 'max_speed.v1',
      definitionVersion: '1',
      definitionLabel: 'Max speed',
      definitionSummary: 'Max instantaneous speed over valid intervals',
      selectedVariant: 'max_valid_interval',
      notes: null,
    },
    {
      definitionId: 'target_quadrant_fraction.v1',
      definitionVersion: '1',
      definitionLabel: 'Target quadrant fraction',
      definitionSummary: 'Fraction of in-trial time in target quadrant',
      selectedVariant: op.quadrantConvention,
      notes: 'Unavailable when target not confirmed',
    },
    {
      definitionId: 'target_quadrant_time.v1',
      definitionVersion: '1',
      definitionLabel: 'Target quadrant time',
      definitionSummary: 'Time in target quadrant (seconds)',
      selectedVariant: op.quadrantConvention,
      notes: 'Unavailable when target not confirmed',
    },
    {
      definitionId: BODY_ENTRY_DEFINITION_ID,
      definitionVersion: BODY_ENTRY_DEFINITION_VERSION,
      definitionLabel: 'Body entry (escape completion)',
      definitionSummary: 'Path A (centroid_pixel) may propose completion; Path B yields uncertain entry only',
      selectedVariant: `v${BODY_ENTRY_DEFINITION_VERSION}`,
      notes: 'See reference/neurotrack-body-entry-v3.md',
    },
    {
      definitionId: 'search_strategy.v1',
      definitionVersion: EVENT_STRATEGY_CLASSIFIER_VERSION,
      definitionLabel: 'Search strategy',
      definitionSummary: 'Heuristic spatial / serial / random / unclassified',
      selectedVariant: EVENT_STRATEGY_CLASSIFIER_VERSION,
      notes: 'Override persisted in provenance',
    },
  ];
}

export const OPERATIONAL_DEFINITION_COLUMNS: (keyof OperationalDefinitionRow)[] = [
  'definitionId',
  'definitionVersion',
  'definitionLabel',
  'definitionSummary',
  'selectedVariant',
  'notes',
];

export function operationalDefinitionRowsToObjects(
  rows: OperationalDefinitionRow[],
): Record<string, string | null>[] {
  return rows.map((row) => ({ ...row }));
}
