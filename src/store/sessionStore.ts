import { create } from 'zustand';
import type { AnalysisParams, Geometry, Hole, TrialRecord, TrialWindow } from '../domain/types';
import { computePxPerCm } from '../domain/calibration/detectMaze';
import { holesFromAnchor } from '../domain/calibration/ringFit';
import { HOLE_COUNT } from '../domain/constants';
import { migrateTrialRecord, migrateAnalysisParams } from '../domain/migration';
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
import { cancelTracking as cancelTrackingJob, runTracking } from '../services/trackingService';
import { clearFrameCache } from '../services/frameService';
import { evictAllFromCache } from '../db/videoCache';

interface SessionState {
  hydrated: boolean;
  saving: boolean;
  ingestBusy: boolean;
  calibrationBusy: boolean;
  trackingBusy: boolean;
  trackingProgress: { phase: string; framesProcessed: number; total: number } | null;
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
  acknowledgeCalibrationReview: (trialId: string) => void;
  confirmGeometry: (trialId: string) => void;
  setTargetHole: (trialId: string, holeId: number) => void;
  confirmTargetHole: (trialId: string) => void;
  clearTargetHole: (trialId: string) => void;
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
  runTracking: (trialId: string) => Promise<void>;
  cancelTracking: (trialId: string) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let calibrationOpSeq = 0;
let windowOpSeq = 0;
let trackingOpSeq = 0;

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
  trackingBusy: false,
  trackingProgress: null,
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
      analysisParams: migrateAnalysisParams(data.analysisParams),
      hydrated: true,
      statusMessage: 'Session restored from local storage.',
    });
  },

  selectTrial: (id) => {
    // Re-selecting the trial that is already active must be a no-op for the frame
    // decoder: clearing the cache here would null out currentFingerprint without
    // anything re-running initFrameDecoder (the player only re-inits when the
    // fingerprint prop actually changes), permanently breaking frame stepping.
    if (id === get().selectedTrialId) {
      return;
    }
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
    const opSeq = ++calibrationOpSeq;
    const fingerprint = trial.fingerprint;
    set({ calibrationBusy: true, statusMessage: 'Detecting maze geometry…' });
    try {
      const result = await runAutoCalibration(trial);
      const current = get().trials.find((t) => t.id === trialId);
      if (opSeq !== calibrationOpSeq || !current || current.fingerprint !== fingerprint) {
        set({ statusMessage: 'Calibration discarded — trial or video changed during detection.' });
        return;
      }
      const holes = result.geometry.holes;
      const confidence = result.confidence ?? result.geometry.detection?.confidence ?? 'failed';

      if (holes && holes.length > 0 && confidence !== 'failed') {
        const det = result.geometry.detection;
        const residual = det?.ringFitResidualPx?.toFixed(1) ?? '?';
        const detected = det?.detectedHoleCount ?? holes.filter((h) => h.source === 'detected').length;
        const modeled = det?.modeledHoleCount ?? holes.filter((h) => h.source === 'model').length;

        let statusMessage: string;
        if (confidence === 'high') {
          statusMessage = `Detected 20 holes (${detected} detected, ${modeled} modeled). Max alignment residual ${residual} px. Review overlay, then confirm.`;
        } else {
          statusMessage = `Low-confidence calibration: ${detected} detected / ${modeled} modeled, max residual ${residual} px. Adjust holes manually before confirming.`;
        }

        set((state) => ({
          trials: patchTrial(state.trials, trialId, (t) => ({
            ...t,
            geometry: {
              ...t.geometry,
              ...result.geometry,
              source: 'auto',
              confirmedAt: null,
              calibrationReviewAcknowledgedAt: null,
            } as Geometry,
          })),
          statusMessage,
        }));
      } else {
        set({
          statusMessage: `Auto-detection failed: ${result.error ?? 'unknown error'}. Use manual calibration.`,
        });
      }
    } catch (err) {
      set({ statusMessage: `Calibration error: ${err instanceof Error ? err.message : err}` });
    } finally {
      set({ calibrationBusy: false });
    }
    scheduleSave(get);
  },

  acknowledgeCalibrationReview: (trialId) => {
    set((state) => ({
      trials: patchTrial(state.trials, trialId, (t) => ({
        ...t,
        geometry: {
          ...t.geometry,
          calibrationReviewAcknowledgedAt: new Date().toISOString(),
        },
      })),
    }));
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
    const trial = get().trials.find((t) => t.id === trialId);
    // Target identity is a scientist decision, never inferred from geometry — an
    // unselected target must stay unknown rather than silently defaulting to Hole 1.
    const resolvedId = trial
      ? trial.geometry.targetHoleId ?? trial.geometry.proposedTargetHoleId
      : null;
    if (resolvedId == null) {
      set({
        statusMessage:
          'Select a target hole before confirming — target identity is not auto-detected.',
      });
      return;
    }
    set((state) => ({
      trials: patchTrial(state.trials, trialId, (t) => ({
        ...t,
        geometry: {
          ...t.geometry,
          targetHoleConfirmedAt: new Date().toISOString(),
          targetHoleId: resolvedId,
        },
      })),
      statusMessage: 'Target hole confirmed.',
    }));
    scheduleSave(get);
  },

  clearTargetHole: (trialId) => {
    set((state) => ({
      trials: patchTrial(state.trials, trialId, (t) => ({
        ...t,
        geometry: {
          ...t.geometry,
          targetHoleId: null,
          targetHoleConfirmedAt: null,
          // Also drop any unconfirmed template-carried proposal — "clear" must fully
          // return to unknown, not leave a suggested hole pre-selected in the dropdown.
          proposedTargetHoleId: null,
        },
      })),
      statusMessage: 'Target hole cleared — target is now unknown.',
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
          calibrationReviewAcknowledgedAt: null,
          detection: {
            holeCandidateCount: 0,
            ringFitResidualPx: 0,
            medianSlotResidualPx: 0,
            rmsSlotResidualPx: 0,
            circleFitResidualPx: 0,
            detectedHoleCount: 0,
            modeledHoleCount: HOLE_COUNT,
            confidence: 'high',
            confidenceReasons: null,
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
          geometry: {
            ...result.geometry,
            calibrationReviewAcknowledgedAt: null,
          },
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
    const opSeq = ++windowOpSeq;
    const fingerprint = trial.fingerprint;
    set({ calibrationBusy: true, statusMessage: 'Detecting trial start…' });
    try {
      const proposal = await proposeTrialWindow(trial);
      const current = get().trials.find((t) => t.id === trialId);
      if (opSeq !== windowOpSeq || !current || current.fingerprint !== fingerprint) {
        set({ statusMessage: 'Trial start detection discarded — trial or video changed during detection.' });
        return;
      }
      set((state) => ({
        trials: patchTrial(state.trials, trialId, (t) => ({
          ...t,
          trialWindow: {
            ...t.trialWindow,
            ...proposal.trialWindow,
            cutoffSeconds: t.trialWindow.cutoffSeconds ?? 180,
            startTimeUs: proposal.success
              ? (proposal.trialWindow.startTimeUs ?? t.trialWindow.startTimeUs)
              : t.trialWindow.startTimeUs,
          },
        })),
        statusMessage: proposal.success
          ? `Proposed trial start at ${proposal.startSeconds!.toFixed(3)} s (confidence ${proposal.confidence!.toFixed(2)}).`
          : (proposal.failureReason ??
            'Automatic trial start detection was inconclusive. Set the start time manually.'),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set((state) => ({
        trials: patchTrial(state.trials, trialId, (t) => ({
          ...t,
          trialWindow: {
            ...t.trialWindow,
            detectionFailureReason: `Trial start detection error: ${msg}. Set the start time manually.`,
          },
        })),
        statusMessage: `Trial window detection failed: ${msg}`,
      }));
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

  runTracking: async (trialId) => {
    const trial = get().trials.find((t) => t.id === trialId);
    if (!trial) return;
    const opSeq = ++trackingOpSeq;
    const fingerprint = trial.fingerprint;
    const params = get().analysisParams.tracking;

    set({
      trackingBusy: true,
      trackingProgress: { phase: 'starting', framesProcessed: 0, total: trial.timestampIndex.length },
      statusMessage: 'Running automatic tracking…',
    });

    try {
      const track = await runTracking(trial, params, (progress) => {
        if (opSeq !== trackingOpSeq) return;
        set({ trackingProgress: progress });
      });

      const current = get().trials.find((t) => t.id === trialId);
      if (opSeq !== trackingOpSeq || !current || current.fingerprint !== fingerprint) {
        set({
          statusMessage: 'Tracking discarded — trial or video changed during run.',
        });
        return;
      }

      set((state) => ({
        trials: patchTrial(state.trials, trialId, (t) => ({ ...t, track })),
        statusMessage:
          track.status === 'done'
            ? `Tracking complete — ${(track.quality!.trackedFraction * 100).toFixed(1)}% tracked (${track.quality!.overallAssessment} quality).`
            : `Tracking ${track.status}: ${track.error ?? 'unknown error'}`,
      }));
    } catch (err) {
      set({
        statusMessage: `Tracking error: ${err instanceof Error ? err.message : err}`,
      });
    } finally {
      if (opSeq === trackingOpSeq) {
        set({ trackingBusy: false, trackingProgress: null });
      }
      scheduleSave(get);
    }
  },

  cancelTracking: () => {
    trackingOpSeq += 1;
    cancelTrackingJob();
    set({
      trackingBusy: false,
      trackingProgress: null,
      statusMessage: 'Tracking cancelled.',
    });
  },
}));

export type { Hole };
