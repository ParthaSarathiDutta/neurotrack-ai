import {
  MAX_HOLE_CANDIDATES,
  MIN_HOLE_CANDIDATES,
} from '../constants';
import type { CalibrationConfidence, Geometry } from '../types';
import { assessCalibrationQuality } from './calibrationQuality';
import { radialApertureCenter } from './refineHoles';
import { findConnectedComponents, type Point } from './connectedComponents';
import { fitCircle } from './circleFit';
import { medianGrayscaleFrame, otsuThreshold } from './otsu';
import { fitHoleRing } from './ringFit';

export interface MazeDetectionResult {
  success: boolean;
  confidence: CalibrationConfidence;
  geometry: Partial<Geometry>;
  roughCenter: Point | null;
  roughRadius: number | null;
  error: string | null;
}

export interface RoughPlatform {
  center: Point;
  radius: number;
}

interface CandidateExtraction {
  holeCandidates: ReturnType<typeof findConnectedComponents>;
  candidatePoints: Point[];
  filteredPoints: Point[];
  circleFit: NonNullable<ReturnType<typeof fitCircle>>;
  darkThreshold: number;
}

/** Detect maze geometry from one or more RGBA reference frames. */
export function detectMazeFromFrames(
  frames: Uint8ClampedArray[],
  width: number,
  height: number,
): MazeDetectionResult {
  if (frames.length === 0) {
    return fail('No frames', null, null);
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
    return fail('Platform not found', null, null);
  }

  brightBlobs.sort((a, b) => b.area - a.area);
  const platform = brightBlobs[0];
  const roughCenter = platform.centroid;
  const roughRadius = Math.sqrt(platform.area / Math.PI);

  const bandPixels: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dist = Math.hypot(x - roughCenter.x, y - roughCenter.y);
      if (dist >= roughRadius * 0.55 && dist <= roughRadius * 1.15) {
        bandPixels.push(ref[(y * width + x) * 4]);
      }
    }
  }
  bandPixels.sort((a, b) => a - b);
  const bandMedian = bandPixels[Math.floor(bandPixels.length / 2)] ?? threshold;

  // Sweep adaptive dark offsets — brighter rigs (e.g. off-center setups) need a wider search.
  const darkOffsets = [8, 10, 12, 14, 16, 18, 20, 22];
  let bestExtraction: CandidateExtraction | null = null;
  let bestScore = Infinity;

  for (const offset of darkOffsets) {
    const extraction = extractCandidates(
      ref,
      width,
      height,
      roughCenter,
      roughRadius,
      threshold,
      bandMedian,
      offset,
    );
    if (!extraction) continue;

    const { filteredPoints, circleFit, holeCandidates } = extraction;
    if (
      holeCandidates.length < MIN_HOLE_CANDIDATES ||
      holeCandidates.length > MAX_HOLE_CANDIDATES
    ) {
      continue;
    }

    const ring = fitHoleRing(filteredPoints, circleFit.center);
    if (!ring) continue;

    const quality = assessCalibrationQuality(ring, circleFit.residualPx);
    const score =
      quality.maxSlotResidualPx * 10 +
      quality.medianSlotResidualPx * 5 +
      quality.modeledCount * 2 -
      quality.detectedCount;

    if (score < bestScore) {
      bestScore = score;
      bestExtraction = extraction;
    }
  }

  if (!bestExtraction) {
    return fail(
      `Hole candidate extraction failed (expected ${MIN_HOLE_CANDIDATES}–${MAX_HOLE_CANDIDATES} candidates)`,
      roughCenter,
      roughRadius,
    );
  }

  const { filteredPoints, circleFit, holeCandidates } = bestExtraction;
  const ring0 = fitHoleRing(filteredPoints, circleFit.center);
  if (!ring0) {
    return fail('Ring fit failed', roughCenter, roughRadius);
  }

  const quality = assessCalibrationQuality(ring0, circleFit.residualPx);

  // Post-fit radial re-seat for detected holes — corrects tangential shadow bias in blob centroids.
  const refinedHoles = ring0.holes.map((hole) => {
    if (hole.source !== 'detected') return hole;
    const center = radialApertureCenter(ref, width, height, ring0.center, hole);
    return { ...hole, x: center.x, y: center.y };
  });
  const ring = { ...ring0, holes: refinedHoles };
  const platformRadiusPx = estimatePlatformEdgeRadius(
    ref,
    width,
    height,
    ring.center,
    threshold,
    ring.holes,
  );

  const geometry: Partial<Geometry> = {
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
      ringFitResidualPx: quality.maxSlotResidualPx,
      medianSlotResidualPx: quality.medianSlotResidualPx,
      rmsSlotResidualPx: quality.rmsSlotResidualPx,
      circleFitResidualPx: quality.circleFitResidualPx,
      detectedHoleCount: quality.detectedCount,
      modeledHoleCount: quality.modeledCount,
      confidence: quality.confidence,
      confidenceReasons: quality.reasons.length > 0 ? quality.reasons : null,
      platformEdgeSampleCount: platformRadiusPx ? 36 : 0,
    },
  };

  const success = quality.confidence === 'high';
  const error =
    quality.confidence === 'high'
      ? null
      : quality.reasons.join(' ') || 'Calibration quality insufficient for automatic confirmation.';

  return {
    success,
    confidence: quality.confidence,
    geometry,
    roughCenter,
    roughRadius,
    error,
  };
}

function extractCandidates(
  ref: Uint8ClampedArray,
  width: number,
  height: number,
  roughCenter: Point,
  roughRadius: number,
  threshold: number,
  bandMedian: number,
  darkOffset: number,
): CandidateExtraction | null {
  const darkThreshold = Math.min(threshold, bandMedian - darkOffset);
  const darkMask = new Array<boolean>(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const gray = ref[idx * 4];
      const dist = Math.hypot(x - roughCenter.x, y - roughCenter.y);
      const inBand = dist >= roughRadius * 0.55 && dist <= roughRadius * 1.15;
      darkMask[idx] = gray < darkThreshold && inBand;
    }
  }

  const darkBlobs = findConnectedComponents(darkMask, width, height);
  const expectedHoleArea = Math.PI * (roughRadius * 0.045) ** 2;
  const minArea = expectedHoleArea * 0.06;
  const maxArea = expectedHoleArea * 8;

  const holeCandidates = darkBlobs.filter(
    (b) =>
      b.area >= minArea &&
      b.area <= maxArea &&
      b.compactness > 0.12 &&
      Math.hypot(b.centroid.x - roughCenter.x, b.centroid.y - roughCenter.y) >=
        roughRadius * 0.5,
  );

  if (holeCandidates.length < MIN_HOLE_CANDIDATES) return null;

  const candidatePoints = holeCandidates.map((b) => b.centroid);
  const circleFit = fitCircle(candidatePoints);
  if (!circleFit) return null;

  // Filter by distance from the geometric ring — not the bright-region centroid.
  const filteredPoints = candidatePoints.filter((p) => {
    const d = Math.hypot(p.x - circleFit.center.x, p.y - circleFit.center.y);
    return d >= circleFit.radius * 0.88 && d <= circleFit.radius * 1.12;
  });

  const pointsForFit =
    filteredPoints.length >= MIN_HOLE_CANDIDATES ? filteredPoints : candidatePoints;
  const refinedCircle = fitCircle(pointsForFit);
  if (!refinedCircle) return null;

  return {
    holeCandidates,
    candidatePoints,
    filteredPoints: pointsForFit,
    circleFit: refinedCircle,
    darkThreshold,
  };
}

function fail(
  error: string,
  roughCenter: Point | null,
  roughRadius: number | null,
): MazeDetectionResult {
  return {
    success: false,
    confidence: 'failed',
    geometry: {},
    roughCenter,
    roughRadius,
    error,
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
