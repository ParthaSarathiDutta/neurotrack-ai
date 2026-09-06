import type { Blob, Point } from '../calibration/connectedComponents';
import {
  TRACKING_RIM_CONTINUITY_FRACTION,
  TRACKING_RIM_MIN_BLOB_AREA_FRACTION,
  TRACKING_RIM_MIN_COMPACTNESS,
} from '../constants';
import type { Geometry, TrackingParams } from '../types';
import { isRimOrHoleContext } from './rimGeometry';

export interface BlobSelectionResult {
  blob: Blob | null;
  sizeScore: number;
  continuityScore: number;
}

export function platformAreaPx(platformRadiusPx: number): number {
  return Math.PI * platformRadiusPx * platformRadiusPx;
}

export function minMaxBlobArea(
  platformRadiusPx: number,
  params: TrackingParams,
  rimRelaxed = false,
): {
  minArea: number;
  maxArea: number;
} {
  const area = platformAreaPx(platformRadiusPx);
  const minFraction = rimRelaxed
    ? Math.min(params.minBlobAreaFraction, TRACKING_RIM_MIN_BLOB_AREA_FRACTION)
    : params.minBlobAreaFraction;
  return {
    minArea: minFraction * area,
    maxArea: params.maxBlobAreaFraction * area,
  };
}

export function isPlausibleBlobSize(
  blob: Blob,
  platformRadiusPx: number,
  params: TrackingParams,
  rimRelaxed = false,
): boolean {
  const { minArea, maxArea } = minMaxBlobArea(platformRadiusPx, params, rimRelaxed);
  const minCompactness = rimRelaxed ? TRACKING_RIM_MIN_COMPACTNESS : 0.05;
  return blob.area >= minArea && blob.area <= maxArea && blob.compactness > minCompactness;
}

export function predictPosition(
  lastCentroid: Point,
  velocity: Point | null,
  deltaTimeUs: number,
): Point {
  if (!velocity || deltaTimeUs <= 0) return lastCentroid;
  const dtSec = deltaTimeUs / 1_000_000;
  return {
    x: lastCentroid.x + velocity.x * dtSec,
    y: lastCentroid.y + velocity.y * dtSec,
  };
}

function sizeScore(
  blob: Blob,
  platformRadiusPx: number,
  params: TrackingParams,
  rimRelaxed = false,
): number {
  const { minArea, maxArea } = minMaxBlobArea(platformRadiusPx, params, rimRelaxed);
  const mid = (minArea + maxArea) / 2;
  const half = (maxArea - minArea) / 2;
  if (half <= 0) return 1;
  const dist = Math.abs(blob.area - mid);
  return Math.max(0, 1 - dist / half);
}

function continuityScore(
  blob: Blob,
  predicted: Point | null,
  platformRadiusPx: number,
  rimRelaxed = false,
): number {
  if (!predicted) return 0.5;
  const dist = Math.hypot(blob.centroid.x - predicted.x, blob.centroid.y - predicted.y);
  const maxDist =
    platformRadiusPx * (rimRelaxed ? TRACKING_RIM_CONTINUITY_FRACTION : 0.25);
  return Math.max(0, 1 - dist / maxDist);
}

function pickBestFromCandidates(
  candidates: Blob[],
  platformRadiusPx: number,
  params: TrackingParams,
  predicted: Point | null,
  rimRelaxed: boolean,
): BlobSelectionResult {
  if (candidates.length === 0) {
    return { blob: null, sizeScore: 0, continuityScore: 0 };
  }

  let best: Blob | null = null;
  let bestScore = -1;
  let bestSize = 0;
  let bestCont = 0;

  for (const blob of candidates) {
    const ss = sizeScore(blob, platformRadiusPx, params, rimRelaxed);
    const cs = continuityScore(blob, predicted, platformRadiusPx, rimRelaxed);
    const score = 0.5 * ss + 0.5 * cs;
    if (score > bestScore) {
      bestScore = score;
      best = blob;
      bestSize = ss;
      bestCont = cs;
    }
  }

  return { blob: best, sizeScore: bestSize, continuityScore: bestCont };
}

/** Pick best plausible blob by size + continuity to predicted position. */
export function selectBestBlob(
  blobs: Blob[],
  platformRadiusPx: number,
  params: TrackingParams,
  predicted: Point | null,
  context?: { lastBody: Point | null; geometry: Geometry | null },
): BlobSelectionResult {
  const candidates = blobs.filter((b) =>
    isPlausibleBlobSize(b, platformRadiusPx, params, false),
  );
  const primary = pickBestFromCandidates(
    candidates,
    platformRadiusPx,
    params,
    predicted,
    false,
  );
  if (primary.blob) return primary;

  const anchor = predicted ?? context?.lastBody ?? null;
  const geometry = context?.geometry ?? null;
  if (!anchor || !geometry || !isRimOrHoleContext(anchor, geometry)) {
    return primary;
  }

  const rimCandidates = blobs.filter((b) =>
    isPlausibleBlobSize(b, platformRadiusPx, params, true),
  );
  return pickBestFromCandidates(
    rimCandidates,
    platformRadiusPx,
    params,
    predicted,
    true,
  );
}
