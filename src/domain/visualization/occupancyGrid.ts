import type { Geometry, Observation } from '../types';
import {
  filterInTrialObservations,
  isUnsupportedTrajectoryGap,
} from './trialObservations';

export interface OccupancyGridModel {
  gridSize: number;
  weights: Float64Array;
  maxWeightUs: number;
  totalWeightUs: number;
  excludedGapUs: number;
  excludedZeroDtPairs: number;
  unitLabel: string;
  platformCenter: { x: number; y: number } | null;
  platformRadiusPx: number | null;
}

const DEFAULT_GRID_SIZE = 32;

function cellIndex(row: number, col: number, gridSize: number): number {
  return row * gridSize + col;
}

/** Time-weighted occupancy on platform circle; skips unsupported gaps and zero/negative dt. */
export function buildOccupancyGrid(
  observations: Observation[],
  geometry: Geometry,
  trialStartUs: number,
  censorUs: number,
  gridSize = DEFAULT_GRID_SIZE,
): OccupancyGridModel {
  const weights = new Float64Array(gridSize * gridSize);
  const center = geometry.platformCenter;
  const radius = geometry.platformRadiusPx;
  const inTrial = filterInTrialObservations(observations, trialStartUs, censorUs);

  let maxWeightUs = 0;
  let totalWeightUs = 0;
  let excludedGapUs = 0;
  let excludedZeroDtPairs = 0;

  if (!center || !radius || radius <= 0) {
    return {
      gridSize,
      weights,
      maxWeightUs: 0,
      totalWeightUs: 0,
      excludedGapUs: 0,
      excludedZeroDtPairs: 0,
      unitLabel: geometry.pxPerCm ? 'cm' : 'px',
      platformCenter: center,
      platformRadiusPx: radius,
    };
  }

  const minX = center.x - radius;
  const minY = center.y - radius;
  const span = radius * 2;

  for (let i = 1; i < inTrial.length; i += 1) {
    const prev = inTrial[i - 1]!;
    const curr = inTrial[i]!;
    const dtUs = curr.timeUs - prev.timeUs;

    if (isUnsupportedTrajectoryGap(prev) || isUnsupportedTrajectoryGap(curr)) {
      excludedGapUs += Math.max(0, dtUs);
      continue;
    }

    if (dtUs <= 0) {
      excludedZeroDtPairs += 1;
      continue;
    }

    const body = prev.bodyXY!;
    const dx = body.x - center.x;
    const dy = body.y - center.y;
    if (Math.hypot(dx, dy) > radius) continue;

    const col = Math.min(
      gridSize - 1,
      Math.max(0, Math.floor(((body.x - minX) / span) * gridSize)),
    );
    const row = Math.min(
      gridSize - 1,
      Math.max(0, Math.floor(((body.y - minY) / span) * gridSize)),
    );
    const idx = cellIndex(row, col, gridSize);
    weights[idx]! += dtUs;
    totalWeightUs += dtUs;
    if (weights[idx]! > maxWeightUs) maxWeightUs = weights[idx]!;
  }

  return {
    gridSize,
    weights,
    maxWeightUs,
    totalWeightUs,
    excludedGapUs,
    excludedZeroDtPairs,
    unitLabel: geometry.pxPerCm ? 'cm (platform-relative)' : 'px (platform-relative)',
    platformCenter: center,
    platformRadiusPx: radius,
  };
}

/** Normalized occupancy fraction per cell (0–1). */
export function occupancyCellFraction(weightUs: number, totalWeightUs: number): number {
  if (totalWeightUs <= 0 || weightUs <= 0) return 0;
  return weightUs / totalWeightUs;
}
