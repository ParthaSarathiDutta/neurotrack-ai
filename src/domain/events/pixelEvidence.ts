import { segmentForegroundBlobs, type PlatformRoi } from '../tracking/foreground';
import type { Hole } from '../types';

export interface PixelFrameSample {
  frameIndex: number;
  timeUs: number;
  data: Uint8ClampedArray;
}

/** Largest foreground blob area inside platform ROI (px²). */
export function animalBlobAreaPx(
  frame: Uint8ClampedArray,
  background: Uint8ClampedArray,
  width: number,
  height: number,
  roi: PlatformRoi,
): number {
  const blobs = segmentForegroundBlobs(frame, background, width, height, roi);
  if (blobs.length === 0) return 0;
  return blobs.reduce((max, b) => Math.max(max, b.area), 0);
}

/** Hole-region darkening relative to background median (0–1, higher = darker hole). */
export function holeDarkeningFraction(
  frame: Uint8ClampedArray,
  background: Uint8ClampedArray,
  width: number,
  height: number,
  hole: Hole,
  holeRadiusPx: number,
): number {
  const r2 = holeRadiusPx * holeRadiusPx;
  let sumFrame = 0;
  let sumBg = 0;
  let count = 0;
  const x0 = Math.max(0, Math.floor(hole.x - holeRadiusPx));
  const x1 = Math.min(width - 1, Math.ceil(hole.x + holeRadiusPx));
  const y0 = Math.max(0, Math.floor(hole.y - holeRadiusPx));
  const y1 = Math.min(height - 1, Math.ceil(hole.y + holeRadiusPx));

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - hole.x;
      const dy = y - hole.y;
      if (dx * dx + dy * dy > r2) continue;
      const i = (y * width + x) * 4;
      const lum = (frame[i]! + frame[i + 1]! + frame[i + 2]!) / 3;
      const bgLum = (background[i]! + background[i + 1]! + background[i + 2]!) / 3;
      sumFrame += lum;
      sumBg += bgLum;
      count += 1;
    }
  }
  if (count === 0 || sumBg <= 0) return 0;
  const meanFrame = sumFrame / count;
  const meanBg = sumBg / count;
  const darkening = (meanBg - meanFrame) / meanBg;
  return Math.max(0, Math.min(1, darkening));
}

export interface AggregatedPixelScores {
  areaDecayScore: number;
  holeDarkeningScore: number;
}

export interface PerFramePixelMetrics {
  frameIndex: number;
  timeUs: number;
  platformBlobArea: number;
  holeDarkening: number;
}

/** Per-frame platform blob area and hole darkening (chronological). */
export function computePerFramePixelMetrics(
  samples: PixelFrameSample[],
  background: Uint8ClampedArray,
  width: number,
  height: number,
  hole: Hole,
  platformCenter: { x: number; y: number },
  platformRadiusPx: number,
): PerFramePixelMetrics[] {
  const roi: PlatformRoi = {
    center: platformCenter,
    radiusPx: platformRadiusPx,
  };
  const holeRadiusPx = Math.max(8, platformRadiusPx * 0.06);
  return samples.map((s) => ({
    frameIndex: s.frameIndex,
    timeUs: s.timeUs,
    platformBlobArea: animalBlobAreaPx(s.data, background, width, height, roi),
    holeDarkening: holeDarkeningFraction(s.data, background, width, height, hole, holeRadiusPx),
  }));
}

/** Aggregate trailing frame samples into conservative 0–1 scores. */
export function aggregatePixelEvidenceScores(
  samples: PixelFrameSample[],
  background: Uint8ClampedArray,
  width: number,
  height: number,
  hole: Hole,
  platformCenter: { x: number; y: number },
  platformRadiusPx: number,
): AggregatedPixelScores {
  if (samples.length === 0) {
    return { areaDecayScore: 0, holeDarkeningScore: 0 };
  }

  const roi: PlatformRoi = {
    center: platformCenter,
    radiusPx: platformRadiusPx,
  };

  const holeRadiusPx = Math.max(8, platformRadiusPx * 0.06);
  const areas = samples.map((s) =>
    animalBlobAreaPx(s.data, background, width, height, roi),
  );
  const darkenings = samples.map((s) =>
    holeDarkeningFraction(s.data, background, width, height, hole, holeRadiusPx),
  );

  const earlyCount = Math.max(1, Math.ceil(areas.length * 0.25));
  const lateCount = Math.max(1, Math.ceil(areas.length * 0.25));
  const earlyMean = areas.slice(0, earlyCount).reduce((a, b) => a + b, 0) / earlyCount;
  const lateMean = areas.slice(-lateCount).reduce((a, b) => a + b, 0) / lateCount;
  const areaDecay =
    earlyMean > 10 ? Math.max(0, Math.min(1, 1 - lateMean / earlyMean)) : 0;
  const holeDarkening = Math.max(...darkenings);

  return {
    areaDecayScore: areaDecay,
    holeDarkeningScore: holeDarkening,
  };
}

/** Select trailing frame indices from onset→censor, capped by budget (trailing-first). */
export function selectPixelEvidenceFrameIndices(
  timestampIndex: { frameIndex: number; timeUs: number }[],
  startFrameIndex: number,
  endFrameIndex: number,
  budget: number,
): number[] {
  const inRange = timestampIndex.filter(
    (e) => e.frameIndex >= startFrameIndex && e.frameIndex <= endFrameIndex,
  );
  if (inRange.length === 0) return [];
  const indices = inRange.map((e) => e.frameIndex);
  if (indices.length <= budget) return indices;
  return indices.slice(-budget);
}
