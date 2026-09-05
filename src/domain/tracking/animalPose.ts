import type { Blob, Point } from '../calibration/connectedComponents';
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
  halfWidth = 8,
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
  if (mag < 1.5) return null;
  return { x: dx / mag, y: dy / mag };
}

function isRimClipped(blob: Blob, width: number, height: number, margin = 3): boolean {
  for (const p of blob.pixels) {
    if (p.x <= margin || p.y <= margin || p.x >= width - 1 - margin || p.y >= height - 1 - margin) {
      return true;
    }
  }
  return false;
}

/** Body centroid + nose from axis extremities; null nose when unreliable. */
export function estimatePose(
  blob: Blob,
  recentCentroids: Point[],
  width: number,
  height: number,
): PoseEstimate {
  const flags: ObservationQualityFlag[] = [];
  const bodyXY = blob.centroid;
  const axis = computeAxisExtremities(blob);

  if (!axis || axis.axisRatio < 1.35) {
    flags.push('ambiguous_head_tail');
    if (isRimClipped(blob, width, height)) flags.push('possible_occlusion');
    return { bodyXY, noseXY: null, qualityFlags: flags, axisRatio: axis?.axisRatio ?? 1 };
  }

  const heading = headingFromHistory(recentCentroids);
  if (!heading) {
    flags.push('ambiguous_head_tail');
    if (isRimClipped(blob, width, height)) flags.push('possible_occlusion');
    return { bodyXY, noseXY: null, qualityFlags: flags, axisRatio: axis.axisRatio };
  }

  const dx = axis.maxProj.x - axis.minProj.x;
  const dy = axis.maxProj.y - axis.minProj.y;
  const axisAngle = Math.atan2(dy, dx);

  const widthAtMin = localWidthAtExtremity(blob, axis.minProj, axisAngle);
  const widthAtMax = localWidthAtExtremity(blob, axis.maxProj, axisAngle);

  const dotMin =
    (axis.minProj.x - bodyXY.x) * heading.x + (axis.minProj.y - bodyXY.y) * heading.y;
  const dotMax =
    (axis.maxProj.x - bodyXY.x) * heading.x + (axis.maxProj.y - bodyXY.y) * heading.y;

  let noseCandidate: Point;
  if (dotMax >= dotMin) {
    noseCandidate = widthAtMax >= widthAtMin ? axis.maxProj : axis.minProj;
  } else {
    noseCandidate = widthAtMin >= widthAtMax ? axis.minProj : axis.maxProj;
  }

  if (isRimClipped(blob, width, height)) {
    flags.push('possible_occlusion');
  }

  return {
    bodyXY,
    noseXY: noseCandidate,
    qualityFlags: flags,
    axisRatio: axis.axisRatio,
  };
}
