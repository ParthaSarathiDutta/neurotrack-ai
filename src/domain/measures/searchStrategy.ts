import { EVENT_STRATEGY_CLASSIFIER_VERSION } from '../constants';
import type {
  BehavioralEvent,
  EventDetectionParams,
  Geometry,
  Observation,
  OperationalDefinitionSelections,
  SearchStrategyClass,
  SearchStrategyResult,
} from '../types';
import { holeAngleDeg, confirmedTargetHoleId } from '../events/holeProximity';
import { isInvestigationConfirmed } from '../events/eventMerge';
import { computePathSpeedMetrics } from './pathMetrics';

export function classifySearchStrategy(
  observations: Observation[],
  events: BehavioralEvent[],
  geometry: Geometry,
  trialStartUs: number,
  endTimeUs: number,
  params: EventDetectionParams,
  opDefs: OperationalDefinitionSelections,
): SearchStrategyResult {
  void opDefs;
  const center = geometry.platformCenter;
  const radius = geometry.platformRadiusPx;
  const targetId = confirmedTargetHoleId(geometry);

  const inTrial = observations.filter(
    (o) => o.timeUs >= trialStartUs && o.timeUs <= endTimeUs && o.bodyXY != null,
  );
  const pathMetrics = computePathSpeedMetrics(observations, trialStartUs, endTimeUs);

  const startObs = inTrial[0];
  const startDistFraction =
    center && radius && startObs?.bodyXY
      ? Math.hypot(startObs.bodyXY.x - center.x, startObs.bodyXY.y - center.y) / radius
      : null;

  const assumptions: string[] = [];
  if (
    startDistFraction != null &&
    startDistFraction > params.strategyNoncentralStartFlagFraction
  ) {
    assumptions.push('noncentral_start');
  }

  const confirmedInvestigations = events.filter(isInvestigationConfirmed);
  const distinctHoles = new Set(confirmedInvestigations.map((e) => e.holeId).filter((id) => id != null));

  const nonTargetBeforeFirstTarget =
    targetId != null
      ? confirmedInvestigations.filter((e) => e.holeId !== targetId).length
      : distinctHoles.size;

  let directnessIndex = 0;
  if (inTrial.length >= 2 && pathMetrics.pathLengthPx > 0) {
    const first = inTrial[0]!.bodyXY!;
    const last = inTrial[inTrial.length - 1]!.bodyXY!;
    const chord = Math.hypot(last.x - first.x, last.y - first.y);
    directnessIndex = chord / pathMetrics.pathLengthPx;
  }

  let centerCrossings = 0;
  if (center && radius) {
    let prevSide: 'inner' | 'outer' | null = null;
    for (const o of inTrial) {
      const d = Math.hypot(o.bodyXY!.x - center.x, o.bodyXY!.y - center.y);
      const side = d < radius * 0.35 ? 'inner' : 'outer';
      if (prevSide && side !== prevSide) centerCrossings += 1;
      prevSide = side;
    }
  }

  let angularMonotonicity = 0;
  if (center && confirmedInvestigations.length >= 3) {
    const angles = confirmedInvestigations
      .map((e) => {
        const hole = geometry.holes.find((h) => h.id === e.holeId);
        return hole ? holeAngleDeg(hole, center) : null;
      })
      .filter((a): a is number => a != null);
    let violations = 0;
    let direction: 1 | -1 | 0 = 0;
    for (let i = 1; i < angles.length; i += 1) {
      const delta = angles[i]! - angles[i - 1]!;
      const sign = delta >= 0 ? 1 : -1;
      if (direction === 0) direction = sign as 1 | -1;
      else if (sign !== direction) violations += 1;
    }
    angularMonotonicity = angles.length > 1 ? 1 - violations / (angles.length - 1) : 0;
  }

  const reasoning = {
    directnessIndex,
    distinctHolesVisited: distinctHoles.size,
    nonTargetInvestigationsBeforeTarget: nonTargetBeforeFirstTarget,
    centerCrossings,
    startDistanceFraction: startDistFraction,
    angularMonotonicity,
    classifierVersion: EVENT_STRATEGY_CLASSIFIER_VERSION,
  };

  let classification: SearchStrategyClass = 'unclassified';

  if (
    directnessIndex >= params.strategyDiThreshold &&
    nonTargetBeforeFirstTarget <= params.strategyMaxDistinctHolesBeforeTarget
  ) {
    classification = 'spatial';
  } else if (
    distinctHoles.size >= params.strategyMinSerialHoles &&
    angularMonotonicity >= 1 - params.strategyMaxSerialViolations / params.strategyMinSerialHoles
  ) {
    classification = 'serial';
  } else if (centerCrossings >= params.strategyCenterCrossingThreshold) {
    classification = 'random';
  }

  if (inTrial.length < 10) {
    classification = 'unclassified';
    assumptions.push('insufficient_trajectory');
  }

  return {
    classification,
    override: null,
    overrideReason: null,
    reasoning,
    classifierVersion: EVENT_STRATEGY_CLASSIFIER_VERSION,
  };
}
