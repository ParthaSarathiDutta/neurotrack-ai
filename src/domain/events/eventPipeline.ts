import { detectEvents } from './detectEvents';
import type { EscapeDetectionContext } from './escape';
import { measuresFromAnalysis } from '../measures/computeMeasures';
import { resolveMeasurementObservations } from '../trajectory/measurementObservations';
import { fetchEscapePixelEvidence } from '../../services/eventFrameEvidenceService';
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
  pixelEvidenceSummary?: string | null;
}

export interface EventPipelineOptions {
  previousEvents?: EventAnalysis | null;
  basisOverride?: MeasurementBasis;
  escapeContext?: EscapeDetectionContext;
  skipPixelPass?: boolean;
}

export function runEventPipeline(
  trial: TrialRecord,
  analysisParams: AnalysisParams,
  options: EventPipelineOptions = {},
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
    escapeContext: options.escapeContext ?? {},
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
    pixelEvidenceSummary: summarizePixelEvidence(events),
  };
}

function summarizePixelEvidence(events: EventAnalysis): string | null {
  const esc = events.events.find((e) => e.type !== 'investigation');
  if (!esc) return null;
  const analyzed = esc.evidence.pixelFramesAnalyzed;
  const requested = esc.evidence.pixelFramesRequested;
  const complete = esc.evidence.pixelEvidenceComplete;
  if (analyzed == null || requested == null) return null;
  if (complete === false) {
    return `Pixel evidence incomplete — ${analyzed}/${requested} frames analyzed.`;
  }
  return `Pixel evidence complete — ${analyzed}/${requested} frames analyzed.`;
}

/** Async pipeline with bounded Phase B pixel pass when Phase A gate passes. */
export async function runEventPipelineAsync(
  trial: TrialRecord,
  analysisParams: AnalysisParams,
  options: EventPipelineOptions = {},
): Promise<EventPipelineResult> {
  if (options.skipPixelPass || options.escapeContext) {
    return runEventPipeline(trial, analysisParams, options);
  }

  const basis = options.basisOverride ?? trial.measurementBasis ?? analysisParams.measurementBasisDefault;
  const resolved = resolveMeasurementObservations(trial.track, basis);
  if (resolved.unavailable) {
    return {
      events: null,
      measures: null,
      message: resolved.unavailableReason,
    };
  }

  const pixelEvidence = await fetchEscapePixelEvidence({
    trial,
    observations: resolved.observations,
    geometry: trial.geometry,
    trialWindow: trial.trialWindow,
    params: analysisParams.events,
  });

  return runEventPipeline(trial, analysisParams, {
    ...options,
    escapeContext: pixelEvidence ? { pixelEvidence } : {},
  });
}
