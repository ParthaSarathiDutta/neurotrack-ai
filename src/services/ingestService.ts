import {
  applyIngestResult,
  createTrialStub,
  markTrialNeedsReselect,
  markTrialVideoCached,
} from '../domain/trialFactory';
import { computeContentFingerprint } from '../domain/fingerprint';
import type { IngestWorkerResponse, IngestWorkerResult, TrialRecord } from '../domain/types';
import {
  attachCacheFlags,
  loadSession,
  saveSession,
  defaultAnalysisParams,
} from '../db/database';
import {
  enforceCacheBudget,
  getCachedVideo,
  putVideoInCache,
  DEFAULT_CACHE_BUDGET_BYTES,
} from '../db/videoCache';

let worker: Worker | null = null;

function getIngestWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/ingest-worker.ts', import.meta.url), {
      type: 'module',
    });
  }
  return worker;
}

export interface IngestCallbacks {
  onProgress?: (trialId: string, framesDecoded: number, total: number) => void;
}

export async function ingestFile(
  file: File,
  existingTrials: TrialRecord[],
  callbacks: IngestCallbacks = {},
): Promise<{ trial: TrialRecord; evictedFingerprints: string[] }> {
  const fingerprint = await computeContentFingerprint(file);
  let trial = existingTrials.find((t) => t.fingerprint === fingerprint);

  if (!trial) {
    trial = createTrialStub(fingerprint, file.name);
  } else {
    trial = { ...trial, fileName: file.name, updatedAt: new Date().toISOString() };
  }

  trial = { ...trial, ingestStatus: 'indexing', ingestError: null };

  await putVideoInCache(fingerprint, file, file.name, DEFAULT_CACHE_BUDGET_BYTES);
  const evicted = await enforceCacheBudget(DEFAULT_CACHE_BUDGET_BYTES);
  trial = markTrialVideoCached(trial);

  const buffer = await file.arrayBuffer();
  const id = `${fingerprint}-${Date.now()}`;

  const result = await new Promise<IngestWorkerResult>((resolve, reject) => {
    const w = getIngestWorker();
    const onMessage = (ev: MessageEvent<IngestWorkerResponse>) => {
      if (ev.data.id !== id) return;
      if (ev.data.type === 'progress' && ev.data.progress) {
        callbacks.onProgress?.(
          trial!.id,
          ev.data.progress.framesDecoded,
          ev.data.progress.total,
        );
        return;
      }
      w.removeEventListener('message', onMessage);
      if (ev.data.type === 'done' && ev.data.result) resolve(ev.data.result);
      else reject(new Error(ev.data.error ?? 'Ingest failed'));
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'ingest', id, buffer: buffer.slice(0), fileName: file.name });
  });

  trial = applyIngestResult(
    trial,
    result.metadata,
    result.timestampIndex,
    result.decodeWallClockMs,
  );

  return { trial, evictedFingerprints: evicted };
}

export async function reassociateFile(
  file: File,
  existingTrials: TrialRecord[],
): Promise<{ trial: TrialRecord | null; evictedFingerprints: string[] }> {
  const fingerprint = await computeContentFingerprint(file);
  const trial = existingTrials.find((t) => t.fingerprint === fingerprint) ?? null;
  if (!trial) return { trial: null, evictedFingerprints: [] };

  await putVideoInCache(fingerprint, file, file.name, DEFAULT_CACHE_BUDGET_BYTES);
  const evicted = await enforceCacheBudget(DEFAULT_CACHE_BUDGET_BYTES);

  return {
    trial: markTrialVideoCached({ ...trial, fileName: file.name }),
    evictedFingerprints: evicted,
  };
}

export async function markEvictedTrials(trials: TrialRecord[], evicted: string[]): Promise<TrialRecord[]> {
  if (evicted.length === 0) return trials;
  const evictedSet = new Set(evicted);
  return trials.map((t) => (evictedSet.has(t.fingerprint) ? markTrialNeedsReselect(t) : t));
}

export async function hydratePersistedSession(): Promise<{
  trials: TrialRecord[];
  selectedTrialId: string | null;
  analysisParams: ReturnType<typeof defaultAnalysisParams>;
}> {
  const stored = await loadSession();
  if (!stored) {
    return {
      trials: [],
      selectedTrialId: null,
      analysisParams: defaultAnalysisParams(),
    };
  }
  const trials = await attachCacheFlags(stored.trials);
  return {
    trials,
    selectedTrialId: stored.selectedTrialId,
    analysisParams: stored.analysisParams,
  };
}

export async function persistSession(state: {
  trials: TrialRecord[];
  selectedTrialId: string | null;
  analysisParams: ReturnType<typeof defaultAnalysisParams>;
}): Promise<void> {
  await saveSession({
    trials: state.trials,
    selectedTrialId: state.selectedTrialId,
    analysisParams: state.analysisParams,
  });
}

export async function isVideoCached(fingerprint: string): Promise<boolean> {
  const row = await getCachedVideo(fingerprint);
  return Boolean(row);
}
