import { findConnectedComponents, type Blob } from '../calibration/connectedComponents';
import { otsuThreshold } from '../calibration/otsu';
import { TRACKING_SEGMENTATION_ROI_MARGIN } from '../constants';

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
  // Slightly expanded capture zone — animals at the rim often extend a few pixels
  // beyond the fitted platform circle while still being on-platform.
  const rMax = roi.radiusPx * TRACKING_SEGMENTATION_ROI_MARGIN;

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
      // Max channel diff survives dark-hole rim contrast better than a single channel.
      const dR = Math.abs(frame[i] - background[i]);
      const dG = Math.abs(frame[i + 1] - background[i + 1]);
      const dB = Math.abs(frame[i + 2] - background[i + 2]);
      const d = Math.max(dR, dG, dB);
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
