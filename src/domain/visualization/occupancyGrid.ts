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

/** ColorBrewer Blues-inspired ramp — distinguishable in grayscale and deuteranopia. */
export function occupancyCellColor(intensity: number): string {
  const t = Math.max(0, Math.min(1, intensity));
  const stops = [
    { t: 0, r: 247, g: 251, b: 255 },
    { t: 0.35, r: 198, g: 219, b: 239 },
    { t: 0.65, r: 107, g: 174, b: 214 },
    { t: 1, r: 8, g: 48, b: 107 },
  ];
  let lower = stops[0]!;
  let upper = stops[stops.length - 1]!;
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (t >= stops[i]!.t && t <= stops[i + 1]!.t) {
      lower = stops[i]!;
      upper = stops[i + 1]!;
      break;
    }
  }
  const span = upper.t - lower.t || 1;
  const u = (t - lower.t) / span;
  const r = Math.round(lower.r + (upper.r - lower.r) * u);
  const g = Math.round(lower.g + (upper.g - lower.g) * u);
  const b = Math.round(lower.b + (upper.b - lower.b) * u);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Place hole number label slightly inward from the hole toward platform center. */
export function occupancyHoleLabelPosition(
  holeX: number,
  holeY: number,
  center: { x: number; y: number },
  radius: number,
  svgSize: number,
  insetPx = 16,
): { cx: number; cy: number; lx: number; ly: number; anchor: 'start' | 'middle' | 'end' } {
  const hole = videoToOccupancySvg(holeX, holeY, center, radius, svgSize);
  const cx = svgSize / 2;
  const cy = svgSize / 2;
  const vx = hole.cx - cx;
  const vy = hole.cy - cy;
  const dist = Math.hypot(vx, vy) || 1;
  const scale = Math.max(0.35, (dist - insetPx) / dist);
  const lx = cx + vx * scale;
  const ly = cy + vy * scale;
  const anchor: 'start' | 'middle' | 'end' =
    Math.abs(vx) < 4 ? 'middle' : vx > 0 ? 'start' : 'end';
  return { cx: hole.cx, cy: hole.cy, lx, ly, anchor };
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
