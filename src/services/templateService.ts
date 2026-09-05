import { computePxPerCm } from '../domain/calibration/detectMaze';
import type { Geometry, TrialRecord } from '../domain/types';
import { runAutoCalibration, getRoughPlatformForTrial } from './calibrationService';

export interface TemplateApplyResult {
  geometry: Geometry;
  discrepancyWarning: string | null;
  destinationDetectionSucceeded: boolean;
}

export function checkTemplateDiscrepancy(
  sourceRough: { center: { x: number; y: number }; radius: number },
  destRough: { center: { x: number; y: number }; radius: number },
): string | null {
  const centerDist = Math.hypot(
    sourceRough.center.x - destRough.center.x,
    sourceRough.center.y - destRough.center.y,
  );
  const radiusDiff = Math.abs(sourceRough.radius - destRough.radius);
  const refRadius = Math.max(sourceRough.radius, destRough.radius);
  const centerDistRel = centerDist / refRadius;
  const radiusDiffRel = radiusDiff / refRadius;

  if (centerDistRel > 0.12 || radiusDiffRel > 0.05) {
    return (
      'This trial\'s rig looks different from the template source — review the overlay carefully before confirming.'
    );
  }
  return null;
}

export async function applyTemplateGeometry(
  sourceTrial: TrialRecord,
  destTrial: TrialRecord,
): Promise<TemplateApplyResult> {
  const sourceGeo = sourceTrial.geometry;
  if (!sourceGeo.confirmedAt) {
    throw new Error('Source trial geometry is not confirmed');
  }

  const destDetection = await runAutoCalibration(destTrial);
  const destRough = destDetection.roughCenter && destDetection.roughRadius
    ? { center: destDetection.roughCenter, radius: destDetection.roughRadius }
    : await getRoughPlatformForTrial(destTrial);

  const sourceRough = await getRoughPlatformForTrial(sourceTrial);

  let discrepancyWarning: string | null = null;
  if (sourceRough && destRough) {
    discrepancyWarning = checkTemplateDiscrepancy(sourceRough, destRough);
  }

  let geometry: Geometry;

  if (destDetection.success && destDetection.geometry.holes?.length === 20) {
    // Use destination's own detection; template only proposes target + diameter
    geometry = {
      ...destTrial.geometry,
      platformCenter: destDetection.geometry.platformCenter ?? null,
      platformRadiusPx: destDetection.geometry.platformRadiusPx ?? null,
      holes: destDetection.geometry.holes ?? [],
      ringRotationDeg: destDetection.geometry.ringRotationDeg ?? null,
      detection: destDetection.geometry.detection ?? null,
      diameterCm: sourceGeo.diameterCm,
      pxPerCm:
        destDetection.geometry.platformRadiusPx && sourceGeo.diameterCm
          ? computePxPerCm(destDetection.geometry.platformRadiusPx, sourceGeo.diameterCm)
          : null,
      proposedTargetHoleId: sourceGeo.targetHoleId,
      targetHoleId: null,
      targetHoleConfirmedAt: null,
      source: 'template',
      templateSourceTrialId: sourceTrial.id,
      confirmedAt: null,
    };
  } else if (destRough && sourceGeo.platformCenter && sourceGeo.platformRadiusPx) {
    // Scale/translate template to destination rough platform
    const scale = destRough.radius / (sourceRough?.radius ?? destRough.radius);
    const dx = destRough.center.x - (sourceGeo.platformCenter.x * scale);
    const dy = destRough.center.y - (sourceGeo.platformCenter.y * scale);

    const holes = sourceGeo.holes.map((h) => ({
      ...h,
      x: h.x * scale + dx,
      y: h.y * scale + dy,
      source: h.source === 'manual' ? ('manual' as const) : ('model' as const),
    }));

    geometry = {
      ...destTrial.geometry,
      platformCenter: destRough.center,
      platformRadiusPx: destRough.radius,
      holes,
      ringRotationDeg: sourceGeo.ringRotationDeg,
      diameterCm: sourceGeo.diameterCm,
      pxPerCm: sourceGeo.diameterCm
        ? computePxPerCm(destRough.radius, sourceGeo.diameterCm)
        : null,
      proposedTargetHoleId: sourceGeo.targetHoleId,
      targetHoleId: null,
      targetHoleConfirmedAt: null,
      source: 'template',
      templateSourceTrialId: sourceTrial.id,
      confirmedAt: null,
      detection: destDetection.geometry.detection ?? null,
    };
  } else {
    throw new Error('Could not align template to destination trial');
  }

  return {
    geometry,
    discrepancyWarning,
    destinationDetectionSucceeded: destDetection.success,
  };
}
