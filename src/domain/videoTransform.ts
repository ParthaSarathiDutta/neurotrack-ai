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

export interface LetterboxedContentRect {
  offsetX: number;
  offsetY: number;
  contentWidth: number;
  contentHeight: number;
}

/** Content area when video uses object-fit: contain inside the display box. */
export function computeLetterboxedContentRect(box: VideoDisplayBox): LetterboxedContentRect {
  const videoAspect = box.videoWidth / box.videoHeight;
  const displayAspect = box.displayWidth / box.displayHeight;

  if (displayAspect > videoAspect) {
    const contentHeight = box.displayHeight;
    const contentWidth = contentHeight * videoAspect;
    return {
      offsetX: (box.displayWidth - contentWidth) / 2,
      offsetY: 0,
      contentWidth,
      contentHeight,
    };
  }

  const contentWidth = box.displayWidth;
  const contentHeight = contentWidth / videoAspect;
  return {
    offsetX: 0,
    offsetY: (box.displayHeight - contentHeight) / 2,
    contentWidth,
    contentHeight,
  };
}

/** Map native video pixel coordinates to display CSS coordinates (letterbox-aware). */
export function videoToDisplay(point: VideoPoint, box: VideoDisplayBox): VideoPoint {
  const rect = computeLetterboxedContentRect(box);
  return {
    x: rect.offsetX + (point.x / box.videoWidth) * rect.contentWidth,
    y: rect.offsetY + (point.y / box.videoHeight) * rect.contentHeight,
  };
}

/** Map display CSS coordinates to native video pixel coordinates (letterbox-aware). */
export function displayToVideo(point: VideoPoint, box: VideoDisplayBox): VideoPoint {
  const rect = computeLetterboxedContentRect(box);
  return {
    x: ((point.x - rect.offsetX) / rect.contentWidth) * box.videoWidth,
    y: ((point.y - rect.offsetY) / rect.contentHeight) * box.videoHeight,
  };
}

/** Find nearest timestamp index entry to a time in seconds. */
export function nearestIndexEntry<T extends { timeUs: number; frameIndex: number }>(
  index: T[],
  timeUs: number,
  options?: { preferredFrameIndex?: number },
): T | null {
  if (index.length === 0) return null;
  let best = index[0];
  let bestDist = Math.abs(best.timeUs - timeUs);

  for (const entry of index) {
    const dist = Math.abs(entry.timeUs - timeUs);
    if (dist < bestDist) {
      best = entry;
      bestDist = dist;
    } else if (dist === bestDist) {
      const preferred = options?.preferredFrameIndex;
      if (preferred != null) {
        if (entry.frameIndex === preferred) {
          best = entry;
        } else if (best.frameIndex !== preferred && entry.frameIndex < best.frameIndex) {
          best = entry;
        }
      } else if (entry.frameIndex < best.frameIndex) {
        best = entry;
      }
    }
  }
  return best;
}

/** All index entries sharing an exact presentation time (0, 1, or more). */
export function indexEntriesAtTimeUs<T extends { timeUs: number }>(
  index: T[],
  timeUs: number,
): T[] {
  return index.filter((e) => e.timeUs === timeUs);
}

/** Find index entry by canonical frame identity. */
export function indexEntryByFrameIndex<T extends { frameIndex: number }>(
  index: T[],
  frameIndex: number,
): T | null {
  return index.find((e) => e.frameIndex === frameIndex) ?? null;
}

/** Find observation (or any row keyed by frameIndex) — never use timeUs alone as a unique key. */
export function findByFrameIndex<T extends { frameIndex: number }>(
  rows: T[],
  frameIndex: number,
): T | null {
  return rows.find((r) => r.frameIndex === frameIndex) ?? null;
}

/** Step frame index forward/backward, clamped to valid range. */
export function stepFrameIndex(
  currentFrameIndex: number,
  delta: number,
  maxFrameIndex: number,
): number {
  return Math.max(0, Math.min(maxFrameIndex, currentFrameIndex + delta));
}
