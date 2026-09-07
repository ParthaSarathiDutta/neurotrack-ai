import { detectEvents } from './detectEvents';
import { measuresFromAnalysis } from '../measures/computeMeasures';
import { resolveMeasurementObservations } from '../trajectory/measurementObservations';
import type {
  AnalysisParams,
  EventAnalysis,
  MeasurementBasis,
  MeasuresSnapshot,
  TrialRecord,
} from '../types';

export interface EventPipelineResult {
  events: EventAnalysis | null;
  measures: MeasuresSnapshot | null;
  message: string | null;
}

export function runEventPipeline(
  trial: TrialRecord,
  analysisParams: AnalysisParams,
  options: { previousEvents?: EventAnalysis | null; basisOverride?: MeasurementBasis } = {},
): EventPipelineResult {
  const basis = options.basisOverride ?? trial.measurementBasis ?? analysisParams.measurementBasisDefault;
  const resolved = resolveMeasurementObservations(trial.track, basis);

  if (resolved.unavailable) {
    return {
      events: null,
      measures: null,
      message: resolved.unavailableReason,
    };
  }

  const events = detectEvents({
    observations: resolved.observations,
    geometry: trial.geometry,
    trialWindow: trial.trialWindow,
    timestampIndex: trial.timestampIndex,
    params: analysisParams.events,
    operationalDefinitions: analysisParams.operationalDefinitions,
    basisUsed: resolved.basisUsed,
    previousEvents: options.previousEvents ?? trial.events,
  });

  const measures = measuresFromAnalysis(
    resolved.observations,
    events,
    trial.geometry,
    trial.trialWindow,
    trial.timestampIndex,
  );

  return {
    events,
    measures,
    message: `Detected ${events.events.filter((e) => e.type === 'investigation').length} investigations.`,
  };
}
