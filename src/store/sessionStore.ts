import { create } from 'zustand';
import type { AnalysisParams, TrialRecord } from '../domain/types';
import { defaultAnalysisParams } from '../db/database';
import {
  hydratePersistedSession,
  ingestFile,
  markEvictedTrials,
  persistSession,
  reassociateFile,
} from '../services/ingestService';
import { evictAllFromCache } from '../db/videoCache';

interface SessionState {
  hydrated: boolean;
  saving: boolean;
  ingestBusy: boolean;
  trials: TrialRecord[];
  selectedTrialId: string | null;
  analysisParams: AnalysisParams;
  statusMessage: string | null;
  hydrate: () => Promise<void>;
  selectTrial: (id: string | null) => void;
  updateTrialLabel: (id: string, label: string) => void;
  addFiles: (files: File[]) => Promise<void>;
  reselectFile: (trialId: string, file: File) => Promise<void>;
  forceEvictCacheForTest: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function flushSave(getState: () => SessionState) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const { trials, selectedTrialId, analysisParams } = getState();
  await persistSession({ trials, selectedTrialId, analysisParams });
}

function scheduleSave(getState: () => SessionState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void flushSave(getState);
  }, 300);
}

function upsertTrial(trials: TrialRecord[], updated: TrialRecord): TrialRecord[] {
  const idx = trials.findIndex((t) => t.id === updated.id);
  if (idx === -1) return [...trials, updated];
  const next = [...trials];
  next[idx] = updated;
  return next;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  hydrated: false,
  saving: false,
  ingestBusy: false,
  trials: [],
  selectedTrialId: null,
  analysisParams: defaultAnalysisParams(),
  statusMessage: null,

  hydrate: async () => {
    const data = await hydratePersistedSession();
    set({ ...data, hydrated: true, statusMessage: 'Session restored from local storage.' });
  },

  selectTrial: (id) => {
    set({ selectedTrialId: id });
    scheduleSave(get);
  },

  updateTrialLabel: (id, label) => {
    set((state) => ({
      trials: state.trials.map((t) =>
        t.id === id ? { ...t, label, updatedAt: new Date().toISOString() } : t,
      ),
    }));
    scheduleSave(get);
  },

  addFiles: async (files) => {
    set({ ingestBusy: true, statusMessage: `Ingesting ${files.length} file(s)…` });
    let trials = get().trials;

    for (const file of files) {
      try {
        const { trial, evictedFingerprints } = await ingestFile(file, trials, {
          onProgress: (_id, decoded, total) => {
            set({ statusMessage: `Decoding ${file.name}: ${decoded}/${total} frames` });
          },
        });
        trials = upsertTrial(trials, trial);
        trials = await markEvictedTrials(trials, evictedFingerprints);
        set({ trials, selectedTrialId: get().selectedTrialId ?? trial.id });
      } catch (err) {
        const fingerprint = trials.find((t) => t.fileName === file.name)?.fingerprint;
        const failed = trials.find((t) => t.fingerprint === fingerprint);
        if (failed) {
          trials = upsertTrial(trials, {
            ...failed,
            ingestStatus: 'error',
            ingestError: err instanceof Error ? err.message : String(err),
          });
        }
        set({
          trials,
          statusMessage: `Failed to ingest ${file.name}: ${err instanceof Error ? err.message : err}`,
        });
      }
    }

    set({ ingestBusy: false, statusMessage: 'Ingest complete.' });
    await flushSave(get);
  },

  reselectFile: async (trialId, file) => {
    set({ ingestBusy: true, statusMessage: 'Re-associating video file…' });
    let trials = get().trials;
    const { trial, evictedFingerprints } = await reassociateFile(file, trials);

    if (!trial) {
      set({ ingestBusy: false, statusMessage: 'Selected file does not match any saved trial.' });
      return;
    }

    trials = upsertTrial(trials, trial);
    trials = await markEvictedTrials(trials, evictedFingerprints);
    set({
      trials,
      selectedTrialId: trialId,
      ingestBusy: false,
      statusMessage: `Re-associated ${file.name} with saved trial "${trial.label}".`,
    });
    await flushSave(get);
  },

  forceEvictCacheForTest: async () => {
    const evicted = await evictAllFromCache();
    let trials = get().trials;
    trials = await markEvictedTrials(trials, evicted);
    set({ trials, statusMessage: 'Video cache cleared (test).' });
    scheduleSave(get);
  },
}));
