import type { TimestampIndexEntry } from '../domain/types';

/** Capture a video frame by seeking the HTMLVideoElement (adequate for frozen pre-trial segments). */
export async function captureFrameViaVideo(
  videoUrl: string,
  timeUs: number,
  width: number,
  height: number,
): Promise<Uint8ClampedArray> {
  const video = document.createElement('video');
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;

  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('Video load failed'));
  });

  video.currentTime = timeUs / 1_000_000;
  await new Promise<void>((resolve) => {
    video.onseeked = () => resolve();
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas context');
  ctx.drawImage(video, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

/** Capture multiple frames at indexed presentation times via video seek. */
export async function captureFramesViaVideo(
  videoUrl: string,
  timestampIndex: TimestampIndexEntry[],
  frameIndices: number[],
  width: number,
  height: number,
): Promise<Uint8ClampedArray[]> {
  const frames: Uint8ClampedArray[] = [];
  for (const idx of frameIndices) {
    const entry = timestampIndex[idx];
    if (!entry) continue;
    frames.push(await captureFrameViaVideo(videoUrl, entry.timeUs, width, height));
  }
  return frames;
}

import { getCachedVideo } from '../db/videoCache';

export async function getVideoBlobUrl(fingerprint: string): Promise<string> {
  const cached = await getCachedVideo(fingerprint);
  if (!cached) throw new Error('Video not in cache');
  return URL.createObjectURL(cached.blob);
}
