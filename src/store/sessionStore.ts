import { create } from 'zustand';
import type { AnalysisParams, Geometry, Hole, TrialRecord, TrialWindow } from '../domain/types';
import { computePxPerCm } from '../domain/calibration/detectMaze';
import { holesFromAnchor } from '../domain/calibration/ringFit';
import { migrateTrialRecord } from '../domain/migration';
import { defaultAnalysisParams } from '../db/database';
import {
  hydratePersistedSession,
  ingestFile,
  markEvictedTrials,
  persistSession,
  reassociateFile,
} from '../services/ingestService';
import { runAutoCalibration } from '../services/calibrationService';
import { applyTemplateGeometry } from '../services/templateService';
import { proposeTrialWindow } from '../services/trialWindowService';
import { clearFrameCache } from '../services/frameService';
import { evictAllFromCache } from '../db/videoCache';

interface SessionState {
  hydrated: boolean;
  saving: boolean;
  ingestBusy: boolean;
  calibrationBusy: boolean;
  templateWarning: string | null;
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
  runAutoDetect: (trialId: string) => Promise<void>;
  confirmGeometry: (trialId: string) => void;
  setTargetHole: (trialId: string, holeId: number) => void;
  confirmTargetHole: (trialId: string) => void;
  setDiameterCm: (trialId: string, diameterCm: number) => void;
  nudgeHole: (trialId: string, holeId: number, x: number, y: number) => void;
  setManualGeometry: (
    trialId: string,
    center: { x: number; y: number },
    radius: number,
    anchorHole: { x: number; y: number },
  ) => void;
  applyTemplate: (destTrialId: string, sourceTrialId: string) => Promise<void>;
  clearTemplateWarning: () => void;
  proposeWindow: (trialId: string) => Promise<void>;
  confirmTrialWindow: (trialId: string) => void;
  updateTrialWindow: (trialId: string, patch: Partial<TrialWindow>) => void;
  updateTrialGeometry: (trialId: string, patch: Partial<Geometry>) => void;
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

function patchTrial(
  trials: TrialRecord[],
  trialId: string,
  patch: Partial<TrialRecord> | ((t: TrialRecord) => TrialRecord),
): TrialRecord[] {
  return trials.map((t) => {
    if (t.id !== trialId) return t;
    const updated = typeof patch === 'function' ? patch(t) : { ...t, ...patch, updatedAt: new Date().toISOString() };
    return updated;
  });
}

export const useSessionStore = create<SessionState>((set, get) => ({
  hydrated: false,
  saving: false,
  ingestBusy: false,
  calibrationBusy: false,
  templateWarning: null,
  trials: [],
  selectedTrialId: null,
  analysisParams: defaultAnalysisParams(),
  statusMessage: null,

  hydrate: async () => {
    const data = await hydratePersistedSession();
    set({
      trials: data.trials.map(migrateTrialRecord),
      selectedTrialId: data.selectedTrialId,
      analysisParams: data.analysisParams,
      hydrated: true,
      statusMessage: 'Session restored from local storage.',
    });
  },

  selectTrial: (id) => {
    clearFrameCache();
    set({ selectedTrialId: id, templateWarning: null });
    scheduleSave(get);
  },

  updateTrialLabel: (id, label) => {
    set((state) => ({
      trials: patchTrial(state.trials, id, { label }),
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
        trials = upsertTrial(trials, migrateTrialRecord(trial));
        trials = await markEvictedTrials(trials, evictedFingerprints);
        set({ trials, selectedTrialId: get().selectedTrialId ?? trial.id });
      } catch (err) {
        set({
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

    trials = upsertTrial(trials, migrateTrialRecord(trial));
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

  runAutoDetect: async (trialId) => {
    const trial = get().trials.find((t) => t.id === trialId);
    if (!trial) return;
    set({ calibrationBusy: true, statusMessage: 'Detecting maze geometry…' });
    try {
      const result = await runAutoCalibration(trial);
      if (result.success && result.geometry.holes) {
        set((state) => ({
          trials: patchTrial(state.trials, trialId, (t) => ({
            ...t,
            geometry: {
              ...t.geometry,
              ...result.geometry,
              source: 'auto',
              confirmedAt: null,
            } as Geometry,
          })),
          statusMessage: `Detected ${result.geometry.holes?.length ?? 0} holes (${result.geometry.detection?.holeCandidateCount ?? '?'} candidates).`,
        }));
      } else {
        set({ statusMessage: `Auto-detection failed: ${result.error ?? 'unknown error'}. Use manual calibration.` });
      }
    } catch (err) {
      set({ statusMessage: `Calibration error: ${err instanceof Error ? err.message : err}` });
    } finally {
      set({ calibrationBusy: false });
    }
    scheduleSave(get);
  },

  confirmGeometry: (trialId) => {
    set((state) => ({
      trials: patchTrial(state.trials, trialId, (t) => ({
        ...t,
        geometry: { ...t.geometry, confirmedAt: new Date().toISOString() },
      })),
      statusMessage: 'Geometry confirmed.',
    }));
    scheduleSave(get);
  },

  setTargetHole: (trialId, holeId) => {
    set((state) => ({
      trials: patchTrial(state.trials, trialId, (t) => ({
        ...t,
        geometry: { ...t.geometry, targetHoleId: holeId },
      })),
    }));
    scheduleSave(get);
  },

  confirmTargetHole: (trialId) => {
    set((state) => ({
      trials: patchTrial(state.trials, trialId, (t) => ({
        ...t,
        geometry: {
          ...t.geometry,
          targetHoleConfirmedAt: new Date().toISOString(),
          targetHoleId: t.geometry.targetHoleId ?? t.geometry.proposedTargetHoleId ?? 0,
        },
      })),
      statusMessage: 'Target hole confirmed.',
    }));
    scheduleSave(get);
  },

  setDiameterCm: (trialId, diameterCm) => {
    set((state) => ({
      trials: patchTrial(state.trials, trialId, (t) => {
        const pxPerCm =
          t.geometry.platformRadiusPx && diameterCm > 0
            ? computePxPerCm(t.geometry.platformRadiusPx, diameterCm)
            : null;
        return {
          ...t,
          geometry: { ...t.geometry, diameterCm, pxPerCm },
        };
      }),
    }));
    scheduleSave(get);
  },

  nudgeHole: (trialId, holeId, x, y) => {
    set((state) => ({
      trials: patchTrial(state.trials, trialId, (t) => ({
        ...t,
        geometry: {
          ...t.geometry,
          holes: t.geometry.holes.map((h) =>
            h.id === holeId ? { ...h, x, y, source: 'manual' as const, confidence: null } : h,
          ),
          confirmedAt: null,
        },
      })),
    }));
    scheduleSave(get);
  },

  setManualGeometry: (trialId, center, radius, anchorHole) => {
    const ring = holesFromAnchor(center, radius, anchorHole);
    set((state) => ({
      trials: patchTrial(state.trials, trialId, (t) => ({
        ...t,
        geometry: {
          ...t.geometry,
          platformCenter: ring.center,
          platformRadiusPx: radius,
          holes: ring.holes,
          ringRotationDeg: ring.rotationDeg,
          source: 'manual',
          confirmedAt: null,
          detection: {
            holeCandidateCount: 0,
            ringFitResidualPx: 0,
            platformEdgeSampleCount: 0,
          },
        },
      })),
      statusMessage: 'Manual geometry set. Confirm when ready.',
    }));
    scheduleSave(get);
  },

  applyTemplate: async (destTrialId, sourceTrialId) => {
    const dest = get().trials.find((t) => t.id === destTrialId);
    const source = get().trials.find((t) => t.id === sourceTrialId);
    if (!dest || !source) return;

    set({ calibrationBusy: true, statusMessage: 'Applying template…' });
    try {
      const result = await applyTemplateGeometry(source, dest);
      set((state) => ({
        trials: patchTrial(state.trials, destTrialId, (t) => ({
          ...t,
          geometry: result.geometry,
        })),
        templateWarning: result.discrepancyWarning,
        statusMessage: result.discrepancyWarning
          ? 'Template applied with discrepancy warning — review carefully.'
          : 'Template applied. Confirm target hole and geometry.',
      }));
    } catch (err) {
      set({ statusMessage: `Template failed: ${err instanceof Error ? err.message : err}` });
    } finally {
      set({ calibrationBusy: false });
    }
    scheduleSave(get);
  },

  clearTemplateWarning: () => set({ templateWarning: null }),

  proposeWindow: async (trialId) => {
    const trial = get().trials.find((t) => t.id === trialId);
    if (!trial) return;
    set({ calibrationBusy: true, statusMessage: 'Detecting trial start…' });
    try {
      const proposal = await proposeTrialWindow(trial);
      if (proposal) {
        set((state) => ({
          trials: patchTrial(state.trials, trialId, (t) => ({
            ...t,
            trialWindow: {
              ...t.trialWindow,
              ...proposal.trialWindow,
              cutoffSeconds: t.trialWindow.cutoffSeconds ?? 180,
            },
          })),
          statusMessage: `Proposed trial start at ${proposal.startSeconds.toFixed(2)} s.`,
        }));
      }
    } catch (err) {
      set({ statusMessage: `Trial window detection failed: ${err instanceof Error ? err.message : err}` });
    } finally {
      set({ calibrationBusy: false });
    }
    scheduleSave(get);
  },

  confirmTrialWindow: (trialId) => {
    set((state) => ({
      trials: patchTrial(state.trials, trialId, (t) => ({
        ...t,
        trialWindow: {
          ...t.trialWindow,
          confirmedAt: new Date().toISOString(),
        },
      })),
      statusMessage: 'Trial window confirmed.',
    }));
    scheduleSave(get);
  },

  updateTrialWindow: (trialId, patch) => {
    set((state) => ({
      trials: patchTrial(state.trials, trialId, (t) => ({
        ...t,
        trialWindow: { ...t.trialWindow, ...patch, source: 'manual' as const },
      })),
    }));
    scheduleSave(get);
  },

  updateTrialGeometry: (trialId, patch) => {
    set((state) => ({
      trials: patchTrial(state.trials, trialId, (t) => ({
        ...t,
        geometry: { ...t.geometry, ...patch },
      })),
    }));
    scheduleSave(get);
  },
}));

export type { Hole };
