import {
  MAX_HOLE_CANDIDATES,
  MAX_RING_FIT_RESIDUAL_PX,
  MIN_HOLE_CANDIDATES,
} from '../constants';
import type { Geometry } from '../types';
import { findConnectedComponents, type Point } from './connectedComponents';
import { fitCircle } from './circleFit';
import { medianGrayscaleFrame, otsuThreshold } from './otsu';
import { fitHoleRing } from './ringFit';

export interface MazeDetectionResult {
  success: boolean;
  geometry: Partial<Geometry>;
  roughCenter: Point | null;
  roughRadius: number | null;
  error: string | null;
}

export interface RoughPlatform {
  center: Point;
  radius: number;
}

/** Detect maze geometry from one or more RGBA reference frames. */
export function detectMazeFromFrames(
  frames: Uint8ClampedArray[],
  width: number,
  height: number,
): MazeDetectionResult {
  if (frames.length === 0) {
    return { success: false, geometry: {}, roughCenter: null, roughRadius: null, error: 'No frames' };
  }

  const ref =
    frames.length === 1 ? frames[0] : medianGrayscaleFrame(frames, width, height);
  const threshold = otsuThreshold(ref, width, height);

  const brightMask = new Array<boolean>(width * height);
  for (let i = 0; i < width * height; i += 1) {
    brightMask[i] = ref[i * 4] >= threshold;
  }

  const brightBlobs = findConnectedComponents(brightMask, width, height);
  if (brightBlobs.length === 0) {
    return {
      success: false,
      geometry: {},
      roughCenter: null,
      roughRadius: null,
      error: 'Platform not found',
    };
  }

  brightBlobs.sort((a, b) => b.area - a.area);
  const platform = brightBlobs[0];
  const roughCenter = platform.centroid;
  const roughRadius = Math.sqrt(platform.area / Math.PI);

  const darkMask = new Array<boolean>(width * height);
  // Local adaptive threshold in radial band — handles uneven lighting (test51)
  const bandPixels: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dist = Math.hypot(x - roughCenter.x, y - roughCenter.y);
      if (dist >= roughRadius * 0.6 && dist <= roughRadius * 1.12) {
        bandPixels.push(ref[(y * width + x) * 4]);
      }
    }
  }
  bandPixels.sort((a, b) => a - b);
  const bandMedian = bandPixels[Math.floor(bandPixels.length / 2)] ?? threshold;
  const darkThreshold = Math.min(threshold, bandMedian - 12);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const gray = ref[idx * 4];
      const dist = Math.hypot(x - roughCenter.x, y - roughCenter.y);
      const inBand = dist >= roughRadius * 0.6 && dist <= roughRadius * 1.12;
      darkMask[idx] = gray < darkThreshold && inBand;
    }
  }

  const darkBlobs = findConnectedComponents(darkMask, width, height);
  const expectedHoleArea = Math.PI * (roughRadius * 0.045) ** 2;
  const minArea = expectedHoleArea * 0.08;
  const maxArea = expectedHoleArea * 6;

  const holeCandidates = darkBlobs.filter(
    (b) =>
      b.area >= minArea &&
      b.area <= maxArea &&
      b.compactness > 0.15 &&
      Math.hypot(b.centroid.x - roughCenter.x, b.centroid.y - roughCenter.y) >=
        roughRadius * 0.55,
  );

  if (
    holeCandidates.length < MIN_HOLE_CANDIDATES ||
    holeCandidates.length > MAX_HOLE_CANDIDATES
  ) {
    return {
      success: false,
      geometry: {},
      roughCenter,
      roughRadius,
      error: `Hole candidate count ${holeCandidates.length} outside expected range`,
    };
  }

  const candidatePoints = holeCandidates.map((b) => b.centroid);

  // Reject outlier centroids far from the expected ring radius
  const dists = candidatePoints.map((p) => Math.hypot(p.x - roughCenter.x, p.y - roughCenter.y));
  const medianDist = [...dists].sort((a, b) => a - b)[Math.floor(dists.length / 2)] ?? roughRadius * 0.9;
  const filteredPoints = candidatePoints.filter((p) => {
    const d = Math.hypot(p.x - roughCenter.x, p.y - roughCenter.y);
    return d >= medianDist * 0.82 && d <= medianDist * 1.18;
  });

  const pointsForFit = filteredPoints.length >= MIN_HOLE_CANDIDATES ? filteredPoints : candidatePoints;

  const circleFit = fitCircle(pointsForFit);
  if (!circleFit) {
    return {
      success: false,
      geometry: {},
      roughCenter,
      roughRadius,
      error: 'Circle fit failed',
    };
  }

  const ring = fitHoleRing(filteredPoints.length >= MIN_HOLE_CANDIDATES ? filteredPoints : candidatePoints, circleFit.center);
  if (!ring || ring.residualPx > MAX_RING_FIT_RESIDUAL_PX) {
    return {
      success: false,
      geometry: {},
      roughCenter,
      roughRadius,
      error: ring
        ? `Ring fit residual ${ring.residualPx.toFixed(1)} px too large`
        : 'Ring fit failed',
    };
  }

  const platformRadiusPx = estimatePlatformEdgeRadius(
    ref,
    width,
    height,
    ring.center,
    threshold,
    ring.holes,
  );

  return {
    success: true,
    roughCenter,
    roughRadius,
    error: null,
    geometry: {
      platformCenter: ring.center,
      platformRadiusPx,
      holes: ring.holes,
      ringRotationDeg: ring.rotationDeg,
      targetHoleId: null,
      proposedTargetHoleId: null,
      targetHoleConfirmedAt: null,
      pxPerCm: null,
      diameterCm: null,
      source: 'auto',
      templateSourceTrialId: null,
      confirmedAt: null,
      detection: {
        holeCandidateCount: holeCandidates.length,
        ringFitResidualPx: ring.residualPx,
        platformEdgeSampleCount: platformRadiusPx ? 36 : 0,
      },
    },
  };
}

/** Rough platform estimate for template discrepancy check. */
export function detectRoughPlatform(
  frame: Uint8ClampedArray,
  width: number,
  height: number,
): RoughPlatform | null {
  const threshold = otsuThreshold(frame, width, height);
  const brightMask = new Array<boolean>(width * height);
  for (let i = 0; i < width * height; i += 1) {
    brightMask[i] = frame[i * 4] >= threshold;
  }
  const blobs = findConnectedComponents(brightMask, width, height);
  if (blobs.length === 0) return null;
  blobs.sort((a, b) => b.area - a.area);
  const platform = blobs[0];
  return {
    center: platform.centroid,
    radius: Math.sqrt(platform.area / Math.PI),
  };
}

function estimatePlatformEdgeRadius(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  center: Point,
  threshold: number,
  holes: Array<{ x: number; y: number }>,
): number | null {
  const samples: number[] = [];
  const numAngles = 36;

  for (let a = 0; a < numAngles; a += 1) {
    const angle = (a / numAngles) * 2 * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // Skip angles that pass through a hole
    const skip = holes.some((h) => {
      const ha = Math.atan2(h.y - center.y, h.x - center.x);
      let diff = Math.abs(ha - angle);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      return diff < 0.15;
    });
    if (skip) continue;

    let lastBright = 0;
    for (let r = 10; r < Math.min(width, height) / 2; r += 1) {
      const x = Math.round(center.x + r * cos);
      const y = Math.round(center.y + r * sin);
      if (x < 0 || y < 0 || x >= width || y >= height) break;
      const gray = data[(y * width + x) * 4];
      if (gray >= threshold) lastBright = r;
      else if (lastBright > 20) {
        samples.push(lastBright);
        break;
      }
    }
  }

  if (samples.length < 8) return null;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

export function computePxPerCm(platformRadiusPx: number, diameterCm: number): number {
  if (diameterCm <= 0) return 0;
  return (platformRadiusPx * 2) / diameterCm;
}
