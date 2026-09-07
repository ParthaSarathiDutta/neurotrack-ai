import type {
  BehavioralEvent,
  EventAnalysis,
  EventDetectionParams,
  Geometry,
  MeasureValue,
  MeasuresSnapshot,
  MeasurementBasis,
  Observation,
  OperationalDefinitionSelections,
  TrialWindow,
} from '../types';
import {
  censorBoundaryTimeUs,
  confirmedTargetHoleId,
  effectiveTrialStartUs,
  isInTargetQuadrantFixedOrientation,
  isInTargetQuadrantTargetCentered,
} from '../events/holeProximity';
import { isInvestigationConfirmed } from '../events/eventMerge';
import { computeErrorCounts, computeTotalErrorCounts } from './errorCounts';
import { computePathSpeedMetrics } from './pathMetrics';
import { classifySearchStrategy } from './searchStrategy';

const DEF_VERSION = '1';

function mv(
  partial: Partial<MeasureValue> & Pick<MeasureValue, 'definitionId' | 'definitionLabel' | 'definitionSummary'>,
): MeasureValue {
  return {
    value: null,
    unit: 's',
    censored: false,
    unavailable: false,
    unavailableReason: null,
    lowerBound: null,
    lowerBoundUnit: null,
    definitionVersion: DEF_VERSION,
    assumptions: [],
    flags: [],
    ...partial,
  };
}

function firstTargetInvestigation(
  events: BehavioralEvent[],
  targetId: number | null,
  variant: OperationalDefinitionSelections['primaryLatencyVariant'],
): BehavioralEvent | null {
  if (targetId == null) return null;
  const targetEvents = events
    .filter((e) => e.type === 'investigation' && e.holeId === targetId)
    .sort((a, b) => a.startTimeUs - b.startTimeUs);

  if (variant === 'first_target_investigation_confirmed_only' || variant === 'first_target_investigation') {
    return targetEvents.find(isInvestigationConfirmed) ?? null;
  }
  return targetEvents[0] ?? null;
}

function escapeEvent(events: BehavioralEvent[]): BehavioralEvent | null {
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

export function computeMeasures(
  observations: Observation[],
  events: BehavioralEvent[],
  geometry: Geometry,
  trialWindow: TrialWindow,
  timestampIndex: { timeUs: number }[],
  params: EventDetectionParams,
  opDefs: OperationalDefinitionSelections,
  basisUsed: MeasurementBasis,
): MeasuresSnapshot | null {
  const trialStart = effectiveTrialStartUs(trialWindow);
  const censorUs = censorBoundaryTimeUs(trialWindow, timestampIndex);
  if (trialStart == null || censorUs == null) return null;

  const targetId = confirmedTargetHoleId(geometry);
  const pathMetrics = computePathSpeedMetrics(observations, trialStart, censorUs);
  const pxPerCm = geometry.pxPerCm;
  const lengthUnit = pxPerCm ? 'cm' : 'px';
  const speedUnit = pxPerCm ? 'cm/s' : 'px/s';
  const pathValue = pxPerCm ? pathMetrics.pathLengthPx / pxPerCm : pathMetrics.pathLengthPx;
  const meanSpeed = pxPerCm
    ? pathMetrics.meanSpeedPxPerSec / pxPerCm
    : pathMetrics.meanSpeedPxPerSec;
  const maxSpeed = pxPerCm ? pathMetrics.maxSpeedPxPerSec / pxPerCm : pathMetrics.maxSpeedPxPerSec;

  const pathAssumptions: string[] = [`basis:${basisUsed}`];
  if (pathMetrics.includesInterpolatedSegments) pathAssumptions.push('includes_interpolated_segments');
  if (pathMetrics.pathLengthExcludedGapUs > 0) {
    pathAssumptions.push(`excluded_gap_us:${pathMetrics.pathLengthExcludedGapUs}`);
  }
  if (!pxPerCm) pathAssumptions.push('scale_unavailable_px');

  const firstTarget = firstTargetInvestigation(events, targetId, opDefs.primaryLatencyVariant);
  const esc = escapeEvent(events);

  const followUpLowerBoundSec =
    esc?.evidence?.observedFollowUpLowerBoundUs != null
      ? Number(esc.evidence.observedFollowUpLowerBoundUs) / 1_000_000
      : (censorUs - trialStart) / 1_000_000;

  const primaryLatency: MeasureValue =
    targetId == null
      ? mv({
          unavailable: true,
          unavailableReason: 'Target hole not confirmed.',
          definitionId: 'primary_latency.v1',
          definitionLabel: 'Primary latency',
          definitionSummary: opDefs.primaryLatencyVariant,
          unit: 's',
        })
      : firstTarget
        ? mv({
            value: (firstTarget.startTimeUs - trialStart) / 1_000_000,
            unit: 's',
            definitionId: 'primary_latency.v1',
            definitionLabel: 'Primary latency',
            definitionSummary: `First confirmed target investigation (${opDefs.primaryLatencyVariant})`,
          })
        : mv({
            censored: true,
            unavailable: false,
            definitionId: 'primary_latency.v1',
            definitionLabel: 'Primary latency',
            definitionSummary: opDefs.primaryLatencyVariant,
            unit: 's',
            flags: ['no_target_visit'],
            lowerBound: followUpLowerBoundSec,
            lowerBoundUnit: 's',
          });

  let totalLatency: MeasureValue;
  if (esc?.type === 'escape_completed' && esc.completionTimeUs != null && esc.status === 'confirmed') {
    totalLatency = mv({
      value: (esc.completionTimeUs - trialStart) / 1_000_000,
      unit: 's',
      definitionId: 'total_latency.v1',
      definitionLabel: 'Total latency',
      definitionSummary: 'Protocol completion time (escape completed, confirmed)',
      ...(esc.origin === 'manual' ? { assumptions: ['manual_completion'] } : {}),
    });
  } else if (esc?.type === 'escape_completed' && esc.completionTimeUs != null && esc.origin === 'manual') {
    totalLatency = mv({
      value: (esc.completionTimeUs - trialStart) / 1_000_000,
      unit: 's',
      definitionId: 'total_latency.v1',
      definitionLabel: 'Total latency',
      definitionSummary: 'Protocol completion time (manual escape completed)',
      assumptions: ['manual_completion'],
    });
  } else if (esc?.type === 'escape_completed' && esc.completionTimeUs != null && esc.status === 'proposed') {
    totalLatency = mv({
      censored: true,
      definitionId: 'total_latency.v1',
      definitionLabel: 'Total latency',
      definitionSummary: 'Protocol completion time — proposed, not confirmed',
      unit: 's',
      lowerBound: followUpLowerBoundSec,
      lowerBoundUnit: 's',
      flags: ['escape_completed_proposed'],
    });
  } else {
    totalLatency = mv({
      censored: true,
      definitionId: 'total_latency.v1',
      definitionLabel: 'Total latency',
      definitionSummary: 'Protocol completion time — not observed',
      unit: 's',
      lowerBound: followUpLowerBoundSec,
      lowerBoundUnit: 's',
      flags: esc ? [esc.type] : ['no_escape_record'],
    });
  }

  const primaryErrors = computeErrorCounts(events, geometry, firstTarget?.startTimeUs ?? null, censorUs);
  const totalErrors = computeTotalErrorCounts(events, geometry, censorUs);

  const primaryErrorsMv: MeasureValue =
    targetId == null
      ? mv({
          unavailable: true,
          unavailableReason: 'Target hole not confirmed.',
          definitionId: 'primary_errors.v1',
          definitionLabel: 'Primary errors',
          definitionSummary: 'Confirmed non-target investigations before first target visit',
          unit: 'count',
        })
      : mv({
          value: primaryErrors.confirmed.total,
          unit: 'count',
          definitionId: 'primary_errors.v1',
          definitionLabel: 'Primary errors',
          definitionSummary: 'Confirmed non-target investigations before first target visit',
          assumptions: [`distinct:${primaryErrors.confirmed.distinctHoleCount}`, `revisits:${primaryErrors.confirmed.revisitCount}`],
        });

  const totalErrorsMv: MeasureValue =
    targetId == null
      ? mv({
          unavailable: true,
          unavailableReason: 'Target hole not confirmed.',
          definitionId: 'total_errors.v1',
          definitionLabel: 'Total errors',
          definitionSummary: 'Confirmed non-target investigations before censor boundary',
          unit: 'count',
        })
      : mv({
          value: totalErrors.confirmed.total,
          unit: 'count',
          definitionId: 'total_errors.v1',
          definitionLabel: 'Total errors',
          definitionSummary: 'Confirmed non-target investigations before censor boundary',
          assumptions: [`distinct:${totalErrors.confirmed.distinctHoleCount}`, `revisits:${totalErrors.confirmed.revisitCount}`],
        });

  let quadrantFraction = 0;
  let quadrantTimeSec = 0;
  let quadrantUnavailable = false;
  let quadrantReason: string | null = null;

  const center = geometry.platformCenter;
  const targetHole = geometry.holes.find((h) => h.id === targetId);

  if (opDefs.quadrantConvention === 'target_centered_90') {
    if (!targetHole || !center) {
      quadrantUnavailable = true;
      quadrantReason = 'Target hole not confirmed.';
    } else {
      let totalWeight = 0;
      let inQuadWeight = 0;
      const sorted = observations
        .filter((o) => o.timeUs >= trialStart && o.timeUs <= censorUs && o.bodyXY)
        .sort((a, b) => a.frameIndex - b.frameIndex);
      for (let i = 1; i < sorted.length; i += 1) {
        const dt = sorted[i]!.timeUs - sorted[i - 1]!.timeUs;
        if (dt <= 0) continue;
        totalWeight += dt;
        if (isInTargetQuadrantTargetCentered(sorted[i - 1]!.bodyXY!, center, targetHole)) {
          inQuadWeight += dt;
        }
      }
      quadrantFraction = totalWeight > 0 ? inQuadWeight / totalWeight : 0;
      quadrantTimeSec = inQuadWeight / 1_000_000;
    }
  } else if (opDefs.quadrantNorthDeg == null || !targetHole || !center) {
    quadrantUnavailable = true;
    quadrantReason = 'Fixed orientation requires quadrantNorthDeg and confirmed target.';
  } else {
    let totalWeight = 0;
    let inQuadWeight = 0;
    const sorted = observations
      .filter((o) => o.timeUs >= trialStart && o.timeUs <= censorUs && o.bodyXY)
      .sort((a, b) => a.frameIndex - b.frameIndex);
    for (let i = 1; i < sorted.length; i += 1) {
      const dt = sorted[i]!.timeUs - sorted[i - 1]!.timeUs;
      if (dt <= 0) continue;
      totalWeight += dt;
      if (
        isInTargetQuadrantFixedOrientation(
          sorted[i - 1]!.bodyXY!,
          center,
          targetHole,
          opDefs.quadrantNorthDeg,
        )
      ) {
        inQuadWeight += dt;
      }
    }
    quadrantFraction = totalWeight > 0 ? inQuadWeight / totalWeight : 0;
    quadrantTimeSec = inQuadWeight / 1_000_000;
  }

  const strategy = classifySearchStrategy(
    observations,
    events,
    geometry,
    trialStart,
    censorUs,
    params,
    opDefs,
  );

  return {
    basisUsed,
    computedAt: new Date().toISOString(),
    primaryLatency,
    totalLatency,
    primaryErrors: primaryErrorsMv,
    totalErrors: totalErrorsMv,
    errorCounts: primaryErrors,
    totalErrorCounts: totalErrors,
    pathLength: mv({
      value: pathValue,
      unit: lengthUnit,
      definitionId: 'path_length.v1',
      definitionLabel: 'Path length',
      definitionSummary: 'Sum of body displacements (D12)',
      assumptions: pathAssumptions,
    }),
    meanSpeed: mv({
      value: meanSpeed,
      unit: speedUnit,
      definitionId: 'mean_speed.v1',
      definitionLabel: 'Mean speed',
      definitionSummary: 'Time-weighted mean over valid intervals',
      assumptions: [
        ...pathAssumptions,
        `valid_intervals:${pathMetrics.validSpeedIntervalCount}`,
        `excluded_zero_dt:${pathMetrics.excludedZeroDtPairs}`,
      ],
    }),
    maxSpeed: mv({
      value: maxSpeed,
      unit: speedUnit,
      definitionId: 'max_speed.v1',
      definitionLabel: 'Max speed',
      definitionSummary: 'Max instantaneous speed over valid intervals',
      assumptions: pathAssumptions,
    }),
    targetQuadrantFraction: quadrantUnavailable
      ? mv({
          unavailable: true,
          unavailableReason: quadrantReason,
          definitionId: 'target_quadrant_fraction.v1',
          definitionLabel: 'Target quadrant fraction',
          definitionSummary: opDefs.quadrantConvention,
          unit: 'fraction',
        })
      : mv({
          value: quadrantFraction,
          unit: 'fraction',
          definitionId: 'target_quadrant_fraction.v1',
          definitionLabel: 'Target quadrant fraction',
          definitionSummary: opDefs.quadrantConvention,
        }),
    targetQuadrantTimeSec: quadrantUnavailable
      ? mv({
          unavailable: true,
          unavailableReason: quadrantReason,
          definitionId: 'target_quadrant_time.v1',
          definitionLabel: 'Target quadrant time',
          definitionSummary: opDefs.quadrantConvention,
          unit: 's',
        })
      : mv({
          value: quadrantTimeSec,
          unit: 's',
          definitionId: 'target_quadrant_time.v1',
          definitionLabel: 'Target quadrant time',
          definitionSummary: opDefs.quadrantConvention,
        }),
    searchStrategy: strategy,
    assumptions: pathAssumptions,
  };
}

export function measuresFromAnalysis(
  observations: Observation[],
  analysis: EventAnalysis,
  geometry: Geometry,
  trialWindow: TrialWindow,
  timestampIndex: { timeUs: number }[],
): MeasuresSnapshot | null {
  return computeMeasures(
    observations,
    analysis.events,
    geometry,
    trialWindow,
    timestampIndex,
    analysis.params,
    analysis.operationalDefinitions,
    analysis.basisUsed,
  );
}
