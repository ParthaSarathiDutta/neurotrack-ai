import type { FrameWorkerRequest, FrameWorkerResponse } from '../domain/types';
import { getCachedVideo } from '../db/videoCache';

let worker: Worker | null = null;
let currentFingerprint: string | null = null;
let cachedDimensions: { width: number; height: number } | null = null;
/** Bumped on clearFrameCache — stale in-flight inits must not commit state. */
let initGeneration = 0;
/** Serializes all worker I/O (init + decode) so messages cannot interleave. */
let workerOpChain: Promise<void> = Promise.resolve();

const frameCache = new Map<number, Uint8ClampedArray>();
const MAX_CACHED_FRAMES = 512;
const FRAME_FETCH_MAX_RETRIES = 2;

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

function enqueueWorkerOp<T>(fn: () => Promise<T>): Promise<T> {
  const result = workerOpChain.then(fn);
  workerOpChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
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

function assertFingerprint(expectedFingerprint?: string): void {
  if (expectedFingerprint && currentFingerprint !== expectedFingerprint) {
    throw new Error(
      `Frame decoder fingerprint mismatch (expected ${expectedFingerprint}, active ${currentFingerprint ?? 'none'})`,
    );
  }
}

export async function initFrameDecoder(fingerprint: string): Promise<{ width: number; height: number }> {
  const gen = initGeneration;
  return enqueueWorkerOp(async () => {
    if (gen !== initGeneration) {
      throw new Error('Frame decoder init superseded');
    }
    if (currentFingerprint === fingerprint && cachedDimensions) {
      return cachedDimensions;
    }

    const cached = await getCachedVideo(fingerprint);
    if (!cached) throw new Error('Video not in cache');

    frameCache.clear();
    const buffer = await cached.blob.arrayBuffer();
    const resp = await postToWorker({
      type: 'init',
      id: '',
      buffer: buffer.slice(0),
      fileName: cached.fileName,
    });

    if (gen !== initGeneration) {
      throw new Error('Frame decoder init superseded');
    }
    if (resp.type !== 'ready' || !resp.width || !resp.height) {
      throw new Error('Frame decoder init failed');
    }

    currentFingerprint = fingerprint;
    cachedDimensions = { width: resp.width, height: resp.height };
    return cachedDimensions;
  });
}

/** Ensure decoder is ready; bounded retries for cold-start races after trial switch. */
export async function ensureFrameDecoder(
  fingerprint: string,
  maxAttempts = 3,
): Promise<{ width: number; height: number }> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await initFrameDecoder(fingerprint);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.includes('superseded') && attempt + 1 < maxAttempts) {
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        continue;
      }
      if (attempt + 1 < maxAttempts) {
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastError ?? new Error('Frame decoder init failed');
}

export function getActiveDecoderFingerprint(): string | null {
  return currentFingerprint;
}

export async function getFramePixels(
  frameIndex: number,
  expectedFingerprint?: string,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  return enqueueWorkerOp(async () => {
    assertFingerprint(expectedFingerprint);

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
      throw new Error(`Failed to get frame ${frameIndex}`);
    }

    const data = new Uint8ClampedArray(resp.frame.data);
    frameCache.set(frameIndex, data);
    evictCacheIfNeeded();

    return { data, width: resp.frame.width, height: resp.frame.height };
  });
}

async function fetchFramesBatchOnce(
  frameIndices: number[],
): Promise<Map<number, Uint8ClampedArray>> {
  const missing = frameIndices.filter((i) => !frameCache.has(i));
  if (missing.length > 0) {
    const resp = await postToWorker({
      type: 'getFrames',
      id: '',
      frameIndices: missing,
    });
    if (resp.type !== 'frames' || !resp.frames) {
      throw new Error(`Batch frame fetch failed for ${missing.length} frame(s)`);
    }
    for (const frame of resp.frames) {
      frameCache.set(frame.frameIndex, new Uint8ClampedArray(frame.data));
    }
    evictCacheIfNeeded();
  }

  const out = new Map<number, Uint8ClampedArray>();
  for (const idx of frameIndices) {
    const data = frameCache.get(idx);
    if (!data) throw new Error(`Frame ${idx} not available after fetch`);
    out.set(idx, data);
  }
  return out;
}

export async function getMultipleFramePixels(
  frameIndices: number[],
  expectedFingerprint?: string,
): Promise<Array<{ frameIndex: number; data: Uint8ClampedArray; width: number; height: number }>> {
  if (frameIndices.length === 0) return [];

  return enqueueWorkerOp(async () => {
    assertFingerprint(expectedFingerprint);

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= FRAME_FETCH_MAX_RETRIES; attempt += 1) {
      try {
        const map = await fetchFramesBatchOnce(frameIndices);
        const dims = cachedDimensions ?? { width: 640, height: 480 };
        return frameIndices.map((idx) => ({
          frameIndex: idx,
          data: map.get(idx)!,
          width: dims.width,
          height: dims.height,
        }));
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < FRAME_FETCH_MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
        }
      }
    }
    throw lastError ?? new Error('Frame batch fetch failed');
  });
}

export function clearFrameCache() {
  initGeneration += 1;
  frameCache.clear();
  currentFingerprint = null;
  cachedDimensions = null;
}

/** Create ImageBitmap from cached frame pixels for display during stepping. */
export async function getFrameBitmap(
  frameIndex: number,
  width: number,
  height: number,
  expectedFingerprint?: string,
): Promise<ImageBitmap> {
  const { data } = await getFramePixels(frameIndex, expectedFingerprint);
  const copy = new Uint8ClampedArray(data);
  const imageData = new ImageData(copy, width, height);
  return createImageBitmap(imageData);
}

/** Test-only: reset worker queue state between isolated runs. */
export function resetFrameServiceForTest(): void {
  initGeneration += 1;
  frameCache.clear();
  currentFingerprint = null;
  cachedDimensions = null;
  workerOpChain = Promise.resolve();
}
