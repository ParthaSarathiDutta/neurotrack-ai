import type { Blob, Point } from '../calibration/connectedComponents';
import {
  TRACKING_NOSE_MIN_AXIS_RATIO,
  TRACKING_NOSE_MIN_HEADING_AXIS_ALIGNMENT,
  TRACKING_NOSE_MIN_HEADING_DISPLACEMENT_PX,
  TRACKING_NOSE_RIM_MARGIN_PX,
  TRACKING_NOSE_WIDTH_CONTRADICTION_RATIO,
  TRACKING_NOSE_WIDTH_HALF_WINDOW_PX,
  TRACKING_NOSE_WIDTH_INSET_PX,
} from '../constants';
import type { ObservationQualityFlag } from '../types';

export interface PoseEstimate {
  bodyXY: Point;
  noseXY: Point | null;
  qualityFlags: ObservationQualityFlag[];
  axisRatio: number;
}

interface AxisExtremities {
  minProj: Point;
  maxProj: Point;
  axisRatio: number;
}

/** Principal-axis extremities from blob pixel set. */
export function computeAxisExtremities(blob: Blob): AxisExtremities | null {
  if (blob.pixels.length < 4) return null;

  let sumX = 0;
  let sumY = 0;
  for (const p of blob.pixels) {
    sumX += p.x;
    sumY += p.y;
  }
  const cx = sumX / blob.pixels.length;
  const cy = sumY / blob.pixels.length;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of blob.pixels) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  let minProj = Infinity;
  let maxProj = -Infinity;
  let minPt = blob.centroid;
  let maxPt = blob.centroid;

  for (const p of blob.pixels) {
    const proj = (p.x - cx) * cos + (p.y - cy) * sin;
    if (proj < minProj) {
      minProj = proj;
      minPt = p;
    }
    if (proj > maxProj) {
      maxProj = proj;
      maxPt = p;
    }
  }

  const majorLen = Math.hypot(maxPt.x - minPt.x, maxPt.y - minPt.y);
  const equivDiameter = 2 * Math.sqrt(blob.area / Math.PI);
  const axisRatio = equivDiameter > 0 ? majorLen / equivDiameter : 1;

  return { minProj: minPt, maxProj: maxPt, axisRatio };
}

function localWidthAtExtremity(
  blob: Blob,
  extremity: Point,
  axisAngle: number,
  halfWidth = TRACKING_NOSE_WIDTH_HALF_WINDOW_PX,
): number {
  const perpCos = Math.cos(axisAngle + Math.PI / 2);
  const perpSin = Math.sin(axisAngle + Math.PI / 2);
  const set = new Set(blob.pixels.map((p) => `${p.x},${p.y}`));
  let count = 0;
  for (let d = -halfWidth; d <= halfWidth; d += 1) {
    const x = Math.round(extremity.x + d * perpCos);
    const y = Math.round(extremity.y + d * perpSin);
    if (set.has(`${x},${y}`)) count += 1;
  }
  return count;
}

function headingFromHistory(recentCentroids: Point[]): Point | null {
  if (recentCentroids.length < 2) return null;
  const a = recentCentroids[recentCentroids.length - 2];
  const b = recentCentroids[recentCentroids.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const mag = Math.hypot(dx, dy);
  if (mag < TRACKING_NOSE_MIN_HEADING_DISPLACEMENT_PX) return null;
  return { x: dx / mag, y: dy / mag };
}

function isRimClipped(
  blob: Blob,
  width: number,
  height: number,
  margin = TRACKING_NOSE_RIM_MARGIN_PX,
): boolean {
  for (const p of blob.pixels) {
    if (p.x <= margin || p.y <= margin || p.x >= width - 1 - margin || p.y >= height - 1 - margin) {
      return true;
    }
  }
  return false;
}

function noNose(bodyXY: Point, axisRatio: number, extraFlags: ObservationQualityFlag[] = []): PoseEstimate {
  return {
    bodyXY,
    noseXY: null,
    qualityFlags: ['ambiguous_head_tail', ...extraFlags],
    axisRatio,
  };
}

/**
 * Body centroid + nose from axis extremities; null nose whenever evidence is anything
 * short of strong agreement between heading and shape (D6) — never a guessed point.
 *
 * Two independent signals must agree for a nose estimate to be emitted:
 *  1. Heading (recent motion direction) must be reasonably aligned with the blob's own
 *     principal axis — otherwise we can't tell which end is "forward" from motion alone.
 *  2. Local width at the heading-implied head end must not be markedly thinner than the
 *     opposite end — a thin "head" end contradicts the tail-is-thin shape prior and is
 *     treated as disagreement between signals, not resolved by picking one side.
 */
export function estimatePose(
  blob: Blob,
  recentCentroids: Point[],
  width: number,
  height: number,
): PoseEstimate {
  const bodyXY = blob.centroid;
  const axis = computeAxisExtremities(blob);
  const clipped = isRimClipped(blob, width, height);
  const occlusionFlags: ObservationQualityFlag[] = clipped ? ['possible_occlusion'] : [];

  if (!axis || axis.axisRatio < TRACKING_NOSE_MIN_AXIS_RATIO) {
    return noNose(bodyXY, axis?.axisRatio ?? 1, occlusionFlags);
  }

  // A rim-clipped blob's true extremities may be truncated by the frame edge — the
  // "tip" we'd measure could just be where the animal exits the frame, not its nose.
  if (clipped) {
    return noNose(bodyXY, axis.axisRatio, occlusionFlags);
  }

  const heading = headingFromHistory(recentCentroids);
  if (!heading) {
    return noNose(bodyXY, axis.axisRatio);
  }

  const dx = axis.maxProj.x - axis.minProj.x;
  const dy = axis.maxProj.y - axis.minProj.y;
  const axisLen = Math.hypot(dx, dy);
  if (axisLen < 1e-6) {
    return noNose(bodyXY, axis.axisRatio);
  }

  const axisUnit = { x: dx / axisLen, y: dy / axisLen };
  const alignment = heading.x * axisUnit.x + heading.y * axisUnit.y;

  if (Math.abs(alignment) < TRACKING_NOSE_MIN_HEADING_AXIS_ALIGNMENT) {
    // Motion is too perpendicular to the body's long axis (lateral movement, noisy
    // heading) to reliably say which extremity is the front.
    return noNose(bodyXY, axis.axisRatio);
  }

  const preferred = alignment > 0 ? axis.maxProj : axis.minProj;
  const other = alignment > 0 ? axis.minProj : axis.maxProj;
  const axisAngle = Math.atan2(dy, dx);

  // Sample width slightly inward from each extremity, not exactly at the tip — the
  // extremity is often a corner pixel of the blob outline, and a perpendicular line
  // through a corner under-measures the true local body thickness there.
  const insetPreferred = {
    x: preferred.x - Math.sign(alignment) * axisUnit.x * TRACKING_NOSE_WIDTH_INSET_PX,
    y: preferred.y - Math.sign(alignment) * axisUnit.y * TRACKING_NOSE_WIDTH_INSET_PX,
  };
  const insetOther = {
    x: other.x + Math.sign(alignment) * axisUnit.x * TRACKING_NOSE_WIDTH_INSET_PX,
    y: other.y + Math.sign(alignment) * axisUnit.y * TRACKING_NOSE_WIDTH_INSET_PX,
  };
  const widthPreferred = localWidthAtExtremity(blob, insetPreferred, axisAngle);
  const widthOther = localWidthAtExtremity(blob, insetOther, axisAngle);

  if (widthOther > 0 && widthPreferred < widthOther * TRACKING_NOSE_WIDTH_CONTRADICTION_RATIO) {
    // Shape evidence (thin/wide profile) disagrees with the heading-implied head end —
    // disagreement between independent signals means the estimate isn't trustworthy,
    // so we do not fall back to trusting shape over heading (or vice versa).
    return noNose(bodyXY, axis.axisRatio);
  }

  // `clipped` was already checked (and returned early if true) above, so the blob's
  // extremities here are untruncated and no occlusion flag applies.
  return {
    bodyXY,
    noseXY: preferred,
    qualityFlags: [],
    axisRatio: axis.axisRatio,
  };
}
