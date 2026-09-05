import type { FrameWorkerRequest, FrameWorkerResponse } from '../domain/types';
import { getCachedVideo } from '../db/videoCache';

let worker: Worker | null = null;
let currentFingerprint: string | null = null;
let cachedDimensions: { width: number; height: number } | null = null;

const frameCache = new Map<number, Uint8ClampedArray>();
const MAX_CACHED_FRAMES = 300;

function getFrameWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/frame-worker.ts', import.meta.url), {
      type: 'module',
    });
  }
  return worker;
}

function evictCacheIfNeeded() {
  if (frameCache.size <= MAX_CACHED_FRAMES) return;
  const keys = [...frameCache.keys()].sort((a, b) => a - b);
  while (frameCache.size > MAX_CACHED_FRAMES) {
    const k = keys.shift();
    if (k !== undefined) frameCache.delete(k);
  }
}

function postToWorker(message: FrameWorkerRequest): Promise<FrameWorkerResponse> {
  const id = `${Date.now()}-${Math.random()}`;
  const payload = { ...message, id };
  return new Promise((resolve, reject) => {
    const w = getFrameWorker();
    const onMessage = (ev: MessageEvent<FrameWorkerResponse>) => {
      if (ev.data.id !== id) return;
      w.removeEventListener('message', onMessage);
      if (ev.data.type === 'error') {
        reject(new Error(ev.data.error ?? 'Frame worker error'));
        return;
      }
      resolve(ev.data);
    };
    w.addEventListener('message', onMessage);
    if (message.type === 'init') {
      w.postMessage(payload, [message.buffer]);
    } else {
      w.postMessage(payload);
    }
  });
}

export async function initFrameDecoder(fingerprint: string): Promise<{ width: number; height: number }> {
  if (currentFingerprint === fingerprint && cachedDimensions) {
    return cachedDimensions;
  }

  const cached = await getCachedVideo(fingerprint);
  if (!cached) throw new Error('Video not in cache');

  frameCache.clear();
  currentFingerprint = fingerprint;

  const buffer = await cached.blob.arrayBuffer();
  const resp = await postToWorker({
    type: 'init',
    id: '',
    buffer: buffer.slice(0),
    fileName: cached.fileName,
  });

  if (resp.type !== 'ready' || !resp.width || !resp.height) {
    throw new Error('Frame decoder init failed');
  }
  cachedDimensions = { width: resp.width, height: resp.height };
  return cachedDimensions;
}

export async function getFramePixels(
  frameIndex: number,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const cached = frameCache.get(frameIndex);
  const dims = cachedDimensions ?? { width: 640, height: 480 };
  if (cached) {
    return { data: cached, width: dims.width, height: dims.height };
  }

  const resp = await postToWorker({
    type: 'getFrame',
    id: '',
    frameIndex,
  });

  if (resp.type !== 'frame' || !resp.frame) {
    throw new Error('Failed to get frame');
  }

  const data = new Uint8ClampedArray(resp.frame.data);
  frameCache.set(frameIndex, data);
  evictCacheIfNeeded();

  return { data, width: resp.frame.width, height: resp.frame.height };
}

export async function getMultipleFramePixels(
  frameIndices: number[],
): Promise<Array<{ frameIndex: number; data: Uint8ClampedArray; width: number; height: number }>> {
  const missing = frameIndices.filter((i) => !frameCache.has(i));
  for (const idx of missing) {
    const resp = await postToWorker({
      type: 'getFrame',
      id: '',
      frameIndex: idx,
    });
    if (resp.type === 'frame' && resp.frame) {
      frameCache.set(resp.frame.frameIndex, new Uint8ClampedArray(resp.frame.data));
      evictCacheIfNeeded();
    }
  }

  const dims = cachedDimensions ?? { width: 640, height: 480 };
  return frameIndices.map((idx) => {
    const data = frameCache.get(idx);
    if (!data) throw new Error(`Frame ${idx} not available`);
    return { frameIndex: idx, data, width: dims.width, height: dims.height };
  });
}

export function clearFrameCache() {
  frameCache.clear();
  currentFingerprint = null;
  cachedDimensions = null;
}

/** Create ImageBitmap from cached frame pixels for display during stepping. */
export async function getFrameBitmap(
  frameIndex: number,
  width: number,
  height: number,
): Promise<ImageBitmap> {
  const { data } = await getFramePixels(frameIndex);
  const copy = new Uint8ClampedArray(data);
  const imageData = new ImageData(copy, width, height);
  return createImageBitmap(imageData);
}
