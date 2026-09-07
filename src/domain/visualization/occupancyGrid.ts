import type { Geometry, Observation } from '../types';
import {
  filterInTrialObservations,
  isUnsupportedTrajectoryGap,
} from './trialObservations';

export interface OccupancyGridModel {
  gridSize: number;
  weights: Float64Array;
  /** Maximum accumulated time (µs) in any single bin. */
  maxWeightUs: number;
  /** Sum of included interval weights (on-platform, valid Δt). */
  totalWeightUs: number;
  /** Trial window duration (censor − start). */
  trialDurationUs: number;
  /** Span covered by consecutive observation pairs (last − first time). */
  observationSpanUs: number;
  excludedGapUs: number;
  excludedOffPlatformUs: number;
  excludedZeroDtPairs: number;
  unitLabel: string;
  platformCenter: { x: number; y: number } | null;
  platformRadiusPx: number | null;
  /** Display normalization: linear map from bin seconds to color intensity. */
  displayNormalization: 'linear_seconds_per_bin';
}

export interface OccupancyAccountingSummary {
  trialDurationSec: number;
  includedWeightSec: number;
  excludedOffPlatformSec: number;
  excludedGapSec: number;
  excludedZeroDtPairs: number;
  reconciledObservationSpanSec: number;
  unaccountedSec: number;
}

const DEFAULT_GRID_SIZE = 32;

function cellIndex(row: number, col: number, gridSize: number): number {
  return row * gridSize + col;
}

/** Time-weighted occupancy on platform circle; skips unsupported gaps, zero Δt, and off-platform starts. */
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
  const trialDurationUs = Math.max(0, censorUs - trialStartUs);
  const observationSpanUs =
    inTrial.length >= 2
      ? Math.max(0, inTrial[inTrial.length - 1]!.timeUs - inTrial[0]!.timeUs)
      : 0;

  let maxWeightUs = 0;
  let totalWeightUs = 0;
  let excludedGapUs = 0;
  let excludedOffPlatformUs = 0;
  let excludedZeroDtPairs = 0;

  if (!center || !radius || radius <= 0) {
    return {
      gridSize,
      weights,
      maxWeightUs: 0,
      totalWeightUs: 0,
      trialDurationUs,
      observationSpanUs,
      excludedGapUs: 0,
      excludedOffPlatformUs: 0,
      excludedZeroDtPairs: 0,
      unitLabel: geometry.pxPerCm ? 'cm (platform-relative)' : 'px (platform-relative)',
      platformCenter: center,
      platformRadiusPx: radius,
      displayNormalization: 'linear_seconds_per_bin',
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
    if (Math.hypot(dx, dy) > radius) {
      excludedOffPlatformUs += dtUs;
      continue;
    }

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
    trialDurationUs,
    observationSpanUs,
    excludedGapUs,
    excludedOffPlatformUs,
    excludedZeroDtPairs,
    unitLabel: geometry.pxPerCm ? 'cm (platform-relative)' : 'px (platform-relative)',
    platformCenter: center,
    platformRadiusPx: radius,
    displayNormalization: 'linear_seconds_per_bin',
  };
}

export function summarizeOccupancyAccounting(model: OccupancyGridModel): OccupancyAccountingSummary {
  const trialDurationSec = model.trialDurationUs / 1_000_000;
  const includedWeightSec = model.totalWeightUs / 1_000_000;
  const excludedOffPlatformSec = model.excludedOffPlatformUs / 1_000_000;
  const excludedGapSec = model.excludedGapUs / 1_000_000;
  const reconciledObservationSpanSec =
    includedWeightSec + excludedOffPlatformSec + excludedGapSec;
  const unaccountedSec = Math.max(0, trialDurationSec - reconciledObservationSpanSec);

  return {
    trialDurationSec,
    includedWeightSec,
    excludedOffPlatformSec,
    excludedGapSec,
    excludedZeroDtPairs: model.excludedZeroDtPairs,
    reconciledObservationSpanSec,
    unaccountedSec,
  };
}

/** Linear color intensity from bin accumulated seconds (not share of trial). */
export function occupancyDisplayIntensity(weightUs: number, maxWeightUs: number): number {
  if (weightUs <= 0 || maxWeightUs <= 0) return 0;
  return Math.max(0, Math.min(1, weightUs / maxWeightUs));
}

/** @deprecated Prefer occupancyDisplayIntensity for heatmap shading. */
export function occupancyCellFraction(weightUs: number, totalWeightUs: number): number {
  if (totalWeightUs <= 0 || weightUs <= 0) return 0;
  return weightUs / totalWeightUs;
}

/** Color-blind-safe blue sequential ramp (light = low, dark = high seconds in bin). */
export function occupancyCellColor(intensity: number): string {
  const t = Math.max(0, Math.min(1, intensity));
  const r = Math.round(222 - t * (222 - 8));
  const g = Math.round(235 - t * (235 - 48));
  const b = Math.round(247 - t * (247 - 107));
  return `rgb(${r}, ${g}, ${b})`;
}

export function videoToOccupancySvg(
  x: number,
  y: number,
  center: { x: number; y: number },
  radius: number,
  svgSize: number,
): { cx: number; cy: number } {
  const minX = center.x - radius;
  const minY = center.y - radius;
  const span = radius * 2;
  return {
    cx: ((x - minX) / span) * svgSize,
    cy: ((y - minY) / span) * svgSize,
  };
}
