import type {
  EventAnalysis,
  EventDetectionParams,
  Geometry,
  MeasurementBasis,
  Observation,
  OperationalDefinitionSelections,
  TrialWindow,
} from '../types';
import { detectInvestigations } from './investigations';
import { detectEscapeOutcome, type EscapeDetectionContext } from './escape';
import { mergeDetectedEvents } from './eventMerge';

export interface DetectEventsInput {
  observations: Observation[];
  geometry: Geometry;
  trialWindow: TrialWindow;
  timestampIndex: { timeUs: number; frameIndex: number }[];
  params: EventDetectionParams;
  operationalDefinitions: OperationalDefinitionSelections;
  basisUsed: MeasurementBasis;
  previousEvents?: EventAnalysis | null;
  escapeContext?: EscapeDetectionContext;
}

export function detectEvents(input: DetectEventsInput): EventAnalysis {
  const investigations = detectInvestigations(
    input.observations,
    input.geometry,
    input.trialWindow,
    input.timestampIndex,
    input.params,
  );

  const escape = detectEscapeOutcome(
    input.observations,
    input.geometry,
    input.trialWindow,
    input.timestampIndex,
    input.params,
    input.escapeContext ?? {},
  );

  const detected = [...investigations, ...(escape ? [escape] : [])];
  const merged = mergeDetectedEvents(input.previousEvents?.events ?? [], detected);

  return {
    events: merged,
    params: { ...input.params },
    operationalDefinitions: { ...input.operationalDefinitions },
    basisUsed: input.basisUsed,
    computedAt: new Date().toISOString(),
    stale: false,
    staleReason: null,
  };
}
