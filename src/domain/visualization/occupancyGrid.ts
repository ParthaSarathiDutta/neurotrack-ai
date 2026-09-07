import type { Geometry, Observation } from '../types';
import {
  filterInTrialObservations,
  isUnsupportedTrajectoryGap,
} from './trialObservations';

export type OccupancyDisplayNormalization =
  | 'linear_seconds_per_bin'
  | 'sqrt_seconds_per_bin'
  | 'log1p_seconds_per_bin';

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
  /** Display-only color mapping; bin weights remain true accumulated seconds. */
  displayNormalization: OccupancyDisplayNormalization;
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

export interface OccupancyBinDistribution {
  nonzeroCount: number;
  maxSec: number;
  medianNonzeroSec: number;
  p90NonzeroSec: number;
  maxOverMedian: number;
  aboveHalfMaxCount: number;
}

const DEFAULT_GRID_SIZE = 32;

/** When max ≫ median and only a few bins dominate, sqrt display improves mid-range contrast. */
const SQRT_MAX_OVER_MEDIAN = 4;
const SQRT_MAX_ABOVE_HALF = 4;

function cellIndex(row: number, col: number, gridSize: number): number {
  return row * gridSize + col;
}

export function analyzeOccupancyBinDistribution(
  weights: Float64Array,
  maxWeightUs: number,
): OccupancyBinDistribution {
  const nonzeroSec = [...weights]
    .filter((w) => w > 0)
    .map((w) => w / 1_000_000)
    .sort((a, b) => a - b);
  const maxSec = maxWeightUs / 1_000_000;
  const medianNonzeroSec =
    nonzeroSec.length > 0 ? nonzeroSec[Math.floor(nonzeroSec.length / 2)]! : 0;
  const p90NonzeroSec =
    nonzeroSec.length > 0 ? nonzeroSec[Math.floor(nonzeroSec.length * 0.9)]! : 0;
  const aboveHalfMaxCount = nonzeroSec.filter((v) => v >= maxSec / 2).length;
  const maxOverMedian =
    medianNonzeroSec > 0 ? maxSec / medianNonzeroSec : maxSec > 0 ? Infinity : 1;

  return {
    nonzeroCount: nonzeroSec.length,
    maxSec,
    medianNonzeroSec,
    p90NonzeroSec,
    maxOverMedian,
    aboveHalfMaxCount,
  };
}

/** Choose a display-only normalization from the bin-second distribution. */
export function resolveOccupancyDisplayNormalization(
  weights: Float64Array,
  maxWeightUs: number,
): OccupancyDisplayNormalization {
  if (maxWeightUs <= 0) return 'linear_seconds_per_bin';

  const stats = analyzeOccupancyBinDistribution(weights, maxWeightUs);
  if (
    stats.maxOverMedian >= SQRT_MAX_OVER_MEDIAN &&
    stats.aboveHalfMaxCount <= SQRT_MAX_ABOVE_HALF &&
    stats.nonzeroCount >= 8
  ) {
    return 'sqrt_seconds_per_bin';
  }
  return 'linear_seconds_per_bin';
}

export function occupancyDisplayNormalizationLabel(
  normalization: OccupancyDisplayNormalization,
): string {
  switch (normalization) {
    case 'sqrt_seconds_per_bin':
      return 'Square-root of seconds per bin (display only)';
    case 'log1p_seconds_per_bin':
      return 'log(1 + seconds) per bin (display only)';
    default:
      return 'Linear seconds per bin (display only)';
  }
}

/** Map accumulated bin seconds to color intensity using the chosen display normalization. */
export function occupancyDisplayIntensity(
  weightUs: number,
  maxWeightUs: number,
  normalization: OccupancyDisplayNormalization = 'linear_seconds_per_bin',
): number {
  if (weightUs <= 0 || maxWeightUs <= 0) return 0;
  const t = Math.max(0, Math.min(1, weightUs / maxWeightUs));
  switch (normalization) {
    case 'sqrt_seconds_per_bin':
      return Math.sqrt(t);
    case 'log1p_seconds_per_bin':
      return Math.log1p(weightUs / 1_000_000) / Math.log1p(maxWeightUs / 1_000_000);
    default:
      return t;
  }
}

/** Color intensity for a legend/bar position that represents fraction of max bin seconds. */
export function occupancyLegendIntensity(
  fractionOfMax: number,
  normalization: OccupancyDisplayNormalization,
): number {
  const t = Math.max(0, Math.min(1, fractionOfMax));
  return occupancyDisplayIntensity(t * 1_000_000, 1_000_000, normalization);
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

  const displayNormalization = resolveOccupancyDisplayNormalization(weights, maxWeightUs);

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
    displayNormalization,
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

/** @deprecated Prefer occupancyDisplayIntensity for heatmap shading. */
export function occupancyCellFraction(weightUs: number, totalWeightUs: number): number {
  if (totalWeightUs <= 0 || weightUs <= 0) return 0;
  return weightUs / totalWeightUs;
}

/** Sequential blue ramp with stronger mid-range contrast for grayscale and deuteranopia. */
export function occupancyCellColor(intensity: number): string {
  const t = Math.max(0, Math.min(1, intensity));
  const stops = [
    { t: 0, r: 242, g: 242, b: 242 },
    { t: 0.15, r: 210, g: 225, b: 240 },
    { t: 0.4, r: 140, g: 180, b: 220 },
    { t: 0.7, r: 55, g: 110, b: 170 },
    { t: 1, r: 0, g: 35, b: 85 },
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

/** Relative luminance (sRGB) for grayscale contrast checks. */
export function occupancyColorLuminance(color: string): number {
  const m = color.match(/rgb\((\d+), (\d+), (\d+)\)/);
  if (!m) return 0;
  const chan = [m[1], m[2], m[3]].map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * chan[0]! + 0.7152 * chan[1]! + 0.0722 * chan[2]!;
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
