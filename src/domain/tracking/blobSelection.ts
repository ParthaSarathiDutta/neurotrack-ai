import type { Blob, Point } from '../calibration/connectedComponents';
import type { TrackingParams } from '../types';

export interface BlobSelectionResult {
  blob: Blob | null;
  sizeScore: number;
  continuityScore: number;
}

export function platformAreaPx(platformRadiusPx: number): number {
  return Math.PI * platformRadiusPx * platformRadiusPx;
}

export function minMaxBlobArea(platformRadiusPx: number, params: TrackingParams): {
  minArea: number;
  maxArea: number;
} {
  const area = platformAreaPx(platformRadiusPx);
  return {
    minArea: params.minBlobAreaFraction * area,
    maxArea: params.maxBlobAreaFraction * area,
  };
}

export function isPlausibleBlobSize(
  blob: Blob,
  platformRadiusPx: number,
  params: TrackingParams,
): boolean {
  const { minArea, maxArea } = minMaxBlobArea(platformRadiusPx, params);
  return blob.area >= minArea && blob.area <= maxArea && blob.compactness > 0.05;
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

function sizeScore(blob: Blob, platformRadiusPx: number, params: TrackingParams): number {
  const { minArea, maxArea } = minMaxBlobArea(platformRadiusPx, params);
  const mid = (minArea + maxArea) / 2;
  const half = (maxArea - minArea) / 2;
  if (half <= 0) return 1;
  const dist = Math.abs(blob.area - mid);
  return Math.max(0, 1 - dist / half);
}

function continuityScore(blob: Blob, predicted: Point | null, platformRadiusPx: number): number {
  if (!predicted) return 0.5;
  const dist = Math.hypot(blob.centroid.x - predicted.x, blob.centroid.y - predicted.y);
  const maxDist = platformRadiusPx * 0.25;
  return Math.max(0, 1 - dist / maxDist);
}

/** Pick best plausible blob by size + continuity to predicted position. */
export function selectBestBlob(
  blobs: Blob[],
  platformRadiusPx: number,
  params: TrackingParams,
  predicted: Point | null,
): BlobSelectionResult {
  const candidates = blobs.filter((b) => isPlausibleBlobSize(b, platformRadiusPx, params));
  if (candidates.length === 0) {
    return { blob: null, sizeScore: 0, continuityScore: 0 };
  }

  let best: Blob | null = null;
  let bestScore = -1;
  let bestSize = 0;
  let bestCont = 0;

  for (const blob of candidates) {
    const ss = sizeScore(blob, platformRadiusPx, params);
    const cs = continuityScore(blob, predicted, platformRadiusPx);
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
