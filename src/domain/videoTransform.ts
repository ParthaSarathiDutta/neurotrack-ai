export interface VideoDisplayBox {
  /** Rendered video element size in CSS pixels. */
  displayWidth: number;
  displayHeight: number;
  /** Native video dimensions in pixels. */
  videoWidth: number;
  videoHeight: number;
}

export interface VideoPoint {
  x: number;
  y: number;
}

/** Map native video pixel coordinates to display CSS coordinates. */
export function videoToDisplay(point: VideoPoint, box: VideoDisplayBox): VideoPoint {
  const scaleX = box.displayWidth / box.videoWidth;
  const scaleY = box.displayHeight / box.videoHeight;
  return { x: point.x * scaleX, y: point.y * scaleY };
}

/** Map display CSS coordinates to native video pixel coordinates. */
export function displayToVideo(point: VideoPoint, box: VideoDisplayBox): VideoPoint {
  const scaleX = box.videoWidth / box.displayWidth;
  const scaleY = box.videoHeight / box.displayHeight;
  return { x: point.x * scaleX, y: point.y * scaleY };
}

/** Find nearest timestamp index entry to a time in seconds. */
export function nearestIndexEntry<T extends { timeUs: number }>(
  index: T[],
  timeUs: number,
): T | null {
  if (index.length === 0) return null;
  let best = index[0];
  let bestDist = Math.abs(best.timeUs - timeUs);
  for (const entry of index) {
    const dist = Math.abs(entry.timeUs - timeUs);
    if (dist < bestDist) {
      best = entry;
      bestDist = dist;
    }
  }
  return best;
}

/** Find index entry by frame index. */
export function indexEntryByFrameIndex<T extends { frameIndex: number }>(
  index: T[],
  frameIndex: number,
): T | null {
  return index.find((e) => e.frameIndex === frameIndex) ?? null;
}

/** Step frame index forward/backward, clamped to valid range. */
export function stepFrameIndex(
  currentFrameIndex: number,
  delta: number,
  maxFrameIndex: number,
): number {
  return Math.max(0, Math.min(maxFrameIndex, currentFrameIndex + delta));
}
