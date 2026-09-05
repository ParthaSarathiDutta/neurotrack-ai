import { findConnectedComponents, type Blob } from '../calibration/connectedComponents';
import { otsuThreshold } from '../calibration/otsu';

export interface PlatformRoi {
  center: { x: number; y: number };
  radiusPx: number;
}

/** Absolute difference foreground mask inside platform circle, then Otsu + connected components. */
export function segmentForegroundBlobs(
  frame: Uint8ClampedArray,
  background: Uint8ClampedArray,
  width: number,
  height: number,
  roi: PlatformRoi,
): Blob[] {
  const n = width * height;
  const diff = new Uint8ClampedArray(n * 4);
  const cx = roi.center.x;
  const cy = roi.center.y;
  const rMax = roi.radiusPx;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const i = idx * 4;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist > rMax) {
        diff[i] = 0;
        diff[i + 1] = 0;
        diff[i + 2] = 0;
        diff[i + 3] = 255;
        continue;
      }
      const d = Math.abs(frame[i] - background[i]);
      diff[i] = d;
      diff[i + 1] = d;
      diff[i + 2] = d;
      diff[i + 3] = 255;
    }
  }

  const threshold = otsuThreshold(diff, width, height);
  const mask = new Array<boolean>(n);
  for (let idx = 0; idx < n; idx += 1) {
    const i = idx * 4;
    const dist = Math.hypot((idx % width) - cx, Math.floor(idx / width) - cy);
    mask[idx] = dist <= rMax && diff[i] > threshold;
  }

  return findConnectedComponents(mask, width, height);
}
