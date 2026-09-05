import { getCachedVideo } from '../db/videoCache';
import type {
  Track,
  TrackingParams,
  TrackingWorkerRequest,
  TrackingWorkerResponse,
  TrialRecord,
} from '../domain/types';
import { createEmptyTrack } from '../domain/trialFactory';

let worker: Worker | null = null;
let activeJobId: string | null = null;

export interface TrackingProgress {
  phase: string;
  framesProcessed: number;
  total: number;
}

function getTrackingWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/tracking-worker.ts', import.meta.url), {
      type: 'module',
    });
  }
  return worker;
}

export function canRunTracking(trial: TrialRecord): { ok: boolean; reason: string | null } {
  if (!trial.geometry.confirmedAt) {
    return { ok: false, reason: 'Confirm maze geometry before tracking.' };
  }
  if (trial.trialWindow.startTimeUs == null) {
    return { ok: false, reason: 'Set or detect trial window start before tracking.' };
  }
  if (!trial.metadata || trial.timestampIndex.length === 0) {
    return { ok: false, reason: 'Video metadata is missing.' };
  }
  if (!trial.geometry.platformCenter || !trial.geometry.platformRadiusPx) {
    return { ok: false, reason: 'Platform geometry is incomplete.' };
  }
  return { ok: true, reason: null };
}

export function cancelTracking(): void {
  if (activeJobId) {
    getTrackingWorker().postMessage({ type: 'cancel', id: activeJobId } satisfies TrackingWorkerRequest);
  }
  activeJobId = null;
}

export async function runTracking(
  trial: TrialRecord,
  params: TrackingParams,
  onProgress?: (p: TrackingProgress) => void,
): Promise<Track> {
  const gate = canRunTracking(trial);
  if (!gate.ok) {
    return { ...createEmptyTrack(params), status: 'failed', error: gate.reason };
  }

  const cached = await getCachedVideo(trial.fingerprint);
  if (!cached) {
    return {
      ...createEmptyTrack(params),
      status: 'failed',
      error: 'Video not in cache — reselect the file before tracking.',
    };
  }

  const jobId = `${trial.fingerprint}-track-${Date.now()}`;
  activeJobId = jobId;

  const buffer = await cached.blob.arrayBuffer();
  const transferable = buffer.slice(0);

  return new Promise((resolve) => {
    const w = getTrackingWorker();

    const onMessage = (ev: MessageEvent<TrackingWorkerResponse>) => {
      if (ev.data.id !== jobId) return;

      if (ev.data.type === 'progress' && ev.data.progress) {
        onProgress?.(ev.data.progress);
        return;
      }

      if (ev.data.type === 'done' && ev.data.result) {
        w.removeEventListener('message', onMessage);
        if (activeJobId === jobId) activeJobId = null;
        resolve({
          status: 'done',
          observations: ev.data.result.observations,
          quality: ev.data.result.quality,
          params,
          computedAt: new Date().toISOString(),
          error: null,
        });
        return;
      }

      if (ev.data.type === 'cancelled') {
        w.removeEventListener('message', onMessage);
        if (activeJobId === jobId) activeJobId = null;
        resolve({ ...createEmptyTrack(params), status: 'cancelled', error: 'Tracking cancelled.' });
        return;
      }

      if (ev.data.type === 'error') {
        w.removeEventListener('message', onMessage);
        if (activeJobId === jobId) activeJobId = null;
        resolve({
          ...createEmptyTrack(params),
          status: 'failed',
          error: ev.data.error ?? 'Tracking worker error',
        });
      }
    };

    w.addEventListener('message', onMessage);
    w.postMessage({
      type: 'track',
      id: jobId,
      buffer: transferable,
      fileName: cached.fileName,
      input: {
        fingerprint: trial.fingerprint,
        timestampIndex: trial.timestampIndex,
        geometry: trial.geometry,
        trialWindow: trial.trialWindow,
        params,
      },
    } satisfies TrackingWorkerRequest);
  });
}
