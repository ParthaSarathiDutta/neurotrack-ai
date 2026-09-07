import {
  cleaningParamsMatch,
  markAppliedCleaningStale,
  STALE_REASON_CALIBRATION,
  STALE_REASON_CLEANING_PARAMS,
  STALE_REASON_GEOMETRY,
  STALE_REASON_MANUAL_CORRECTION,
  STALE_REASON_TRIAL_WINDOW,
} from '../domain/trajectory/cleaningStaleness';
import { create } from 'zustand';
import { resolveEffectiveObservations } from '../domain/trajectory/resolveObservations';
import { runEventPipeline } from '../domain/events/eventPipeline';
import { markEventAnalysisStale } from '../domain/events/eventStaleness';
import { measuresFromAnalysis } from '../domain/measures/computeMeasures';
import { resolveMeasurementObservations } from '../domain/trajectory/measurementObservations';
import type { AnalysisParams, CleaningParams, EventDetectionParams, Geometry, Hole, ManualCorrection, MeasurementBasis, Observation, OperationalDefinitionSelections, TrialRecord, TrialWindow } from '../domain/types';
import { computeCleanedTrajectory } from '../domain/trajectory/cleaning';
import {
  applyManualCorrections,
  removeManualCorrection,
  upsertManualCorrection,
} from '../domain/trajectory/manualCorrection';
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

export type CorrectionMode = 'off' | 'body' | 'nose' | 'remove-nose';

interface SessionState {
  hydrated: boolean;
  saving: boolean;
  ingestBusy: boolean;
  calibrationBusy: boolean;
  trackingBusy: boolean;
  eventsBusy: boolean;
  trackingProgress: { phase: string; framesProcessed: number; total: number } | null;
  correctionMode: CorrectionMode;
  cleaningPreviewByTrialId: Record<string, Observation[] | null>;
  templateWarning: string | null;
  trials: TrialRecord[];
  selectedTrialId: string | null;
  analysisParams: AnalysisParams;
  statusMessage: string | null;
  /** True while a debounced or in-flight Dexie session write is pending. */
  persistPending: boolean;
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
  setCorrectionMode: (mode: CorrectionMode) => void;
  applyManualBodyCorrection: (trialId: string, frameIndex: number, x: number, y: number) => void;
  applyManualNoseCorrection: (trialId: string, frameIndex: number, x: number, y: number) => void;
  removeManualNoseCorrection: (trialId: string, frameIndex: number) => void;
  resetManualCorrection: (trialId: string, frameIndex: number) => void;
  updateCleaningParams: (patch: Partial<CleaningParams>) => void;
  previewCleaning: (trialId: string) => void;
  applyCleaning: (trialId: string) => void;
  discardCleaningPreview: (trialId: string) => void;
  detectEvents: (trialId: string) => Promise<void>;
  setMeasurementBasis: (trialId: string, basis: MeasurementBasis) => void;
  confirmEvent: (trialId: string, eventId: string) => void;
  rejectEvent: (trialId: string, eventId: string) => void;
  updateEventParams: (patch: Partial<EventDetectionParams>) => void;
  updateOperationalDefinitions: (patch: Partial<OperationalDefinitionSelections>) => void;
  /** Await completion of any pending session write (used after corrections / apply cleaning). */
  flushPersist: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let calibrationOpSeq = 0;
let windowOpSeq = 0;
let trackingOpSeq = 0;

type StoreSet = (
  partial: Partial<SessionState> | ((state: SessionState) => Partial<SessionState>),
) => void;

async function flushSave(getState: () => SessionState, setState: StoreSet): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  setState({ saving: true, persistPending: true });
  try {
    const { trials, selectedTrialId, analysisParams } = getState();
    await persistSession({ trials, selectedTrialId, analysisParams });
    setState({ saving: false, persistPending: false });
  } catch (err) {
    setState({ saving: false, persistPending: false });
    throw err;
  }
}

function scheduleSave(getState: () => SessionState, setState: StoreSet): void {
  setState({ persistPending: true });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void flushSave(getState, setState);
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

function staleTrialTrack(trial: TrialRecord, reason: string): TrialRecord {
  if (!trial.track) return trial;
  return { ...trial, track: markAppliedCleaningStale(trial.track, reason) };
}

function recomputeMeasuresForTrial(trial: TrialRecord, analysisParams: AnalysisParams): TrialRecord {
  if (!trial.events) return { ...trial, measures: null };
  const resolved = resolveMeasurementObservations(trial.track, trial.measurementBasis ?? analysisParams.measurementBasisDefault);
  if (resolved.unavailable) return { ...trial, measures: null };
  const measures = measuresFromAnalysis(
    resolved.observations,
    trial.events,
    trial.geometry,
    trial.trialWindow,
    trial.timestampIndex,
  );
  return { ...trial, measures };
}

function redetectEventsForTrial(trial: TrialRecord, analysisParams: AnalysisParams): TrialRecord {
  if (!trial.track || trial.track.status !== 'done') return trial;
  const result = runEventPipeline(trial, analysisParams, { previousEvents: trial.events });
  if (!result.events) {
    return {
      ...trial,
      events: markEventAnalysisStale(trial.events, result.message ?? 'Unavailable'),
      measures: null,
    };
  }
  return { ...trial, events: result.events, measures: result.measures };
}

function staleTrialById(trials: TrialRecord[], trialId: string, reason: string): TrialRecord[] {
  return patchTrial(trials, trialId, (t) => staleTrialTrack(t, reason));
}

export const useSessionStore = create<SessionState>((set, get) => ({
  hydrated: false,
  saving: false,
  ingestBusy: false,
  calibrationBusy: false,
  trackingBusy: false,
  eventsBusy: false,
  trackingProgress: null,
  correctionMode: 'off',
  cleaningPreviewByTrialId: {},
  templateWarning: null,
  trials: [],
  selectedTrialId: null,
  analysisParams: defaultAnalysisParams(),
  statusMessage: null,
  persistPending: false,

  flushPersist: () => flushSave(get, set),

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
    scheduleSave(get, set);
  },

  updateTrialLabel: (id, label) => {
    set((state) => ({
      trials: patchTrial(state.trials, id, { label }),
    }));
    scheduleSave(get, set);
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
    await flushSave(get, set);
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
    await flushSave(get, set);
  },

  forceEvictCacheForTest: async () => {
    const evicted = await evictAllFromCache();
    let trials = get().trials;
    trials = await markEvictedTrials(trials, evicted);
    set({ trials, statusMessage: 'Video cache cleared (test).' });
    scheduleSave(get, set);
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
          trials: staleTrialById(
            patchTrial(state.trials, trialId, (t) => ({
              ...t,
              geometry: {
                ...t.geometry,
                ...result.geometry,
                source: 'auto',
                confirmedAt: null,
                calibrationReviewAcknowledgedAt: null,
              } as Geometry,
            })),
            trialId,
            STALE_REASON_CALIBRATION,
          ),
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
    scheduleSave(get, set);
  },

  acknowledgeCalibrationReview: (trialId) => {
    set((state) => ({
      trials: staleTrialById(
        patchTrial(state.trials, trialId, (t) => ({
          ...t,
          geometry: {
            ...t.geometry,
            calibrationReviewAcknowledgedAt: new Date().toISOString(),
          },
        })),
        trialId,
        STALE_REASON_CALIBRATION,
      ),
    }));
    scheduleSave(get, set);
  },

  confirmGeometry: (trialId) => {
    set((state) => ({
      trials: staleTrialById(
        patchTrial(state.trials, trialId, (t) => ({
          ...t,
          geometry: { ...t.geometry, confirmedAt: new Date().toISOString() },
        })),
        trialId,
        STALE_REASON_GEOMETRY,
      ),
      statusMessage: 'Geometry confirmed.',
    }));
    scheduleSave(get, set);
  },

  setTargetHole: (trialId, holeId) => {
    set((state) => ({
      trials: patchTrial(state.trials, trialId, (t) => ({
        ...t,
        geometry: { ...t.geometry, targetHoleId: holeId },
      })),
    }));
    scheduleSave(get, set);
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
    scheduleSave(get, set);
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
    scheduleSave(get, set);
  },

  setDiameterCm: (trialId, diameterCm) => {
    set((state) => ({
      trials: staleTrialById(
        patchTrial(state.trials, trialId, (t) => {
          const pxPerCm =
            t.geometry.platformRadiusPx && diameterCm > 0
              ? computePxPerCm(t.geometry.platformRadiusPx, diameterCm)
              : null;
          return {
            ...t,
            geometry: { ...t.geometry, diameterCm, pxPerCm },
          };
        }),
        trialId,
        STALE_REASON_GEOMETRY,
      ),
    }));
    scheduleSave(get, set);
  },

  nudgeHole: (trialId, holeId, x, y) => {
    set((state) => ({
      trials: staleTrialById(
        patchTrial(state.trials, trialId, (t) => ({
          ...t,
          geometry: {
            ...t.geometry,
            holes: t.geometry.holes.map((h) =>
              h.id === holeId ? { ...h, x, y, source: 'manual' as const, confidence: null } : h,
            ),
            confirmedAt: null,
          },
        })),
        trialId,
        STALE_REASON_GEOMETRY,
      ),
    }));
    scheduleSave(get, set);
  },

  setManualGeometry: (trialId, center, radius, anchorHole) => {
    const ring = holesFromAnchor(center, radius, anchorHole);
    set((state) => ({
      trials: staleTrialById(
        patchTrial(state.trials, trialId, (t) => ({
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
        trialId,
        STALE_REASON_GEOMETRY,
      ),
      statusMessage: 'Manual geometry set. Confirm when ready.',
    }));
    scheduleSave(get, set);
  },

  applyTemplate: async (destTrialId, sourceTrialId) => {
    const dest = get().trials.find((t) => t.id === destTrialId);
    const source = get().trials.find((t) => t.id === sourceTrialId);
    if (!dest || !source) return;

    set({ calibrationBusy: true, statusMessage: 'Applying template…' });
    try {
      const result = await applyTemplateGeometry(source, dest);
      set((state) => ({
        trials: staleTrialById(
          patchTrial(state.trials, destTrialId, (t) => ({
            ...t,
            geometry: {
              ...result.geometry,
              calibrationReviewAcknowledgedAt: null,
            },
          })),
          destTrialId,
          STALE_REASON_GEOMETRY,
        ),
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
    scheduleSave(get, set);
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
        trials: staleTrialById(
          patchTrial(state.trials, trialId, (t) => ({
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
          trialId,
          STALE_REASON_TRIAL_WINDOW,
        ),
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
    scheduleSave(get, set);
  },

  confirmTrialWindow: (trialId) => {
    set((state) => ({
      trials: staleTrialById(
        patchTrial(state.trials, trialId, (t) => ({
          ...t,
          trialWindow: {
            ...t.trialWindow,
            confirmedAt: new Date().toISOString(),
          },
        })),
        trialId,
        STALE_REASON_TRIAL_WINDOW,
      ),
      statusMessage: 'Trial window confirmed.',
    }));
    scheduleSave(get, set);
  },

  updateTrialWindow: (trialId, patch) => {
    set((state) => ({
      trials: staleTrialById(
        patchTrial(state.trials, trialId, (t) => ({
          ...t,
          trialWindow: { ...t.trialWindow, ...patch, source: 'manual' as const },
        })),
        trialId,
        STALE_REASON_TRIAL_WINDOW,
      ),
    }));
    scheduleSave(get, set);
  },

  updateTrialGeometry: (trialId, patch) => {
    set((state) => ({
      trials: staleTrialById(
        patchTrial(state.trials, trialId, (t) => ({
          ...t,
          geometry: { ...t.geometry, ...patch },
        })),
        trialId,
        STALE_REASON_GEOMETRY,
      ),
    }));
    scheduleSave(get, set);
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
        trials: patchTrial(state.trials, trialId, (t) => ({
          ...t,
          track,
          events: null,
          measures: null,
        })),
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
      void flushSave(get, set);
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

  setCorrectionMode: (mode) => {
    set({ correctionMode: mode });
  },

  applyManualBodyCorrection: (trialId, frameIndex, x, y) => {
    set((state) => {
      const trial = state.trials.find((t) => t.id === trialId);
      if (!trial?.track?.observations.length) return state;
      const entry = trial.timestampIndex[frameIndex];
      if (!entry) return state;
      const existing = trial.track.manualCorrections.find((c) => c.frameIndex === frameIndex);
      const correction: ManualCorrection = {
        frameIndex,
        timeUs: entry.timeUs,
        bodyXY: { x, y },
        noseXY: existing?.noseXY ?? null,
        correctedAt: new Date().toISOString(),
      };
      return {
        correctionMode: state.correctionMode,
        cleaningPreviewByTrialId: { ...state.cleaningPreviewByTrialId, [trialId]: null },
        trials: patchTrial(state.trials, trialId, (t) => {
          const patched = {
            ...t,
            track: t.track
              ? markAppliedCleaningStale(
                  {
                    ...t.track,
                    manualCorrections: upsertManualCorrection(t.track.manualCorrections, correction),
                  },
                  STALE_REASON_MANUAL_CORRECTION,
                )
              : t.track,
          };
          return t.events ? redetectEventsForTrial(patched, state.analysisParams) : patched;
        }),
        statusMessage: `Manual body correction saved for frame ${frameIndex + 1}.`,
      };
    });
    void flushSave(get, set);
  },

  applyManualNoseCorrection: (trialId, frameIndex, x, y) => {
    set((state) => {
      const trial = state.trials.find((t) => t.id === trialId);
      if (!trial?.track?.observations.length) return state;
      const entry = trial.timestampIndex[frameIndex];
      if (!entry) return state;
      const raw = trial.track.observations.find((o) => o.frameIndex === frameIndex);
      const existing = trial.track.manualCorrections.find((c) => c.frameIndex === frameIndex);
      const body = existing?.bodyXY ?? raw?.bodyXY;
      if (!body) return { ...state, statusMessage: 'Set a body position before placing the nose.' };
      const correction: ManualCorrection = {
        frameIndex,
        timeUs: entry.timeUs,
        bodyXY: body,
        noseXY: { x, y },
        correctedAt: new Date().toISOString(),
      };
      return {
        cleaningPreviewByTrialId: { ...state.cleaningPreviewByTrialId, [trialId]: null },
        trials: patchTrial(state.trials, trialId, (t) => ({
          ...t,
          track: t.track
            ? markAppliedCleaningStale(
                {
                  ...t.track,
                  manualCorrections: upsertManualCorrection(t.track.manualCorrections, correction),
                },
                STALE_REASON_MANUAL_CORRECTION,
              )
            : t.track,
        })),
        statusMessage: `Manual nose correction saved for frame ${frameIndex + 1}.`,
      };
    });
    void flushSave(get, set);
  },

  removeManualNoseCorrection: (trialId, frameIndex) => {
    set((state) => {
      const trial = state.trials.find((t) => t.id === trialId);
      if (!trial?.track) return state;
      const existing = trial.track.manualCorrections.find((c) => c.frameIndex === frameIndex);
      const entry = trial.timestampIndex[frameIndex];
      if (!existing?.bodyXY || !entry) {
        return { ...state, statusMessage: 'No manual nose to remove on this frame.' };
      }
      const correction: ManualCorrection = {
        ...existing,
        noseXY: null,
        correctedAt: new Date().toISOString(),
      };
      return {
        cleaningPreviewByTrialId: { ...state.cleaningPreviewByTrialId, [trialId]: null },
        trials: patchTrial(state.trials, trialId, (t) => ({
          ...t,
          track: t.track
            ? markAppliedCleaningStale(
                {
                  ...t.track,
                  manualCorrections: upsertManualCorrection(t.track.manualCorrections, correction),
                },
                STALE_REASON_MANUAL_CORRECTION,
              )
            : t.track,
        })),
        statusMessage: `Nose removed for frame ${frameIndex + 1}.`,
      };
    });
    void flushSave(get, set);
  },

  resetManualCorrection: (trialId, frameIndex) => {
    set((state) => ({
      cleaningPreviewByTrialId: { ...state.cleaningPreviewByTrialId, [trialId]: null },
      trials: patchTrial(state.trials, trialId, (t) => ({
        ...t,
        track: t.track
          ? markAppliedCleaningStale(
              {
                ...t.track,
                manualCorrections: removeManualCorrection(t.track.manualCorrections, frameIndex),
              },
              STALE_REASON_MANUAL_CORRECTION,
            )
          : t.track,
      })),
      statusMessage: `Frame ${frameIndex + 1} restored to automatic tracking.`,
    }));
    void flushSave(get, set);
  },

  updateCleaningParams: (patch) => {
    set((state) => {
      const cleaning = {
        ...state.analysisParams.cleaning,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      const trials = state.trials.map((t) => {
        if (!t.track?.appliedCleaning || t.track.appliedCleaning.stale) return t;
        if (cleaningParamsMatch(t.track.appliedCleaning.params, cleaning)) return t;
        return staleTrialTrack(t, STALE_REASON_CLEANING_PARAMS);
      });
      const clearedPreviews = Object.fromEntries(
        Object.keys(state.cleaningPreviewByTrialId).map((trialId) => [trialId, null]),
      );
      return {
        trials,
        cleaningPreviewByTrialId: clearedPreviews,
        analysisParams: {
          ...state.analysisParams,
          cleaning,
          updatedAt: new Date().toISOString(),
        },
        statusMessage: Object.values(state.cleaningPreviewByTrialId).some((p) => p != null)
          ? 'Cleaning parameters changed — preview cleared. Click Preview cleaning to refresh.'
          : state.statusMessage,
      };
    });
    scheduleSave(get, set);
  },

  previewCleaning: (trialId) => {
    const state = get();
    const trial = state.trials.find((t) => t.id === trialId);
    if (!trial?.track?.observations.length) return;
    const corrected = applyManualCorrections(
      trial.track.observations,
      trial.track.manualCorrections,
    );
    const preview = computeCleanedTrajectory(
      corrected,
      state.analysisParams.cleaning,
      trial.track.params.maxPlausibleSpeedPxPerSec,
    );
    set({
      cleaningPreviewByTrialId: { ...state.cleaningPreviewByTrialId, [trialId]: preview },
      statusMessage: 'Cleaning preview ready — review overlay, then Apply or Discard.',
    });
  },

  applyCleaning: (trialId) => {
    const state = get();
    const trial = state.trials.find((t) => t.id === trialId);
    if (!trial?.track?.observations.length) return;
    let preview = state.cleaningPreviewByTrialId[trialId];
    if (!preview) {
      const corrected = applyManualCorrections(
        trial.track.observations,
        trial.track.manualCorrections,
      );
      preview = computeCleanedTrajectory(
        corrected,
        state.analysisParams.cleaning,
        trial.track.params.maxPlausibleSpeedPxPerSec,
      );
    }
    const params = state.analysisParams.cleaning;
    set({
      cleaningPreviewByTrialId: { ...state.cleaningPreviewByTrialId, [trialId]: null },
      trials: patchTrial(state.trials, trialId, (t) => {
        const patched = {
          ...t,
          track: t.track
            ? {
                ...t.track,
                appliedCleaning: {
                  observations: preview!,
                  params: { ...params },
                  appliedAt: new Date().toISOString(),
                  stale: false,
                  staleReason: null,
                },
              }
            : t.track,
        };
        return t.events ? redetectEventsForTrial(patched, state.analysisParams) : patched;
      }),
      statusMessage: 'Trajectory cleaning applied.',
    });
    void flushSave(get, set);
  },

  discardCleaningPreview: (trialId) => {
    set((state) => ({
      cleaningPreviewByTrialId: { ...state.cleaningPreviewByTrialId, [trialId]: null },
      statusMessage: 'Cleaning preview discarded.',
    }));
  },

  detectEvents: async (trialId) => {
    const trial = get().trials.find((t) => t.id === trialId);
    if (!trial?.track || trial.track.status !== 'done') return;
    set({ eventsBusy: true, statusMessage: 'Detecting events…' });
    try {
      const result = runEventPipeline(trial, get().analysisParams);
      set((state) => ({
        trials: patchTrial(state.trials, trialId, (t) => ({
          ...t,
          events: result.events,
          measures: result.measures,
        })),
        statusMessage: result.message ?? 'Event detection complete.',
      }));
      await flushSave(get, set);
    } finally {
      set({ eventsBusy: false });
    }
  },

  setMeasurementBasis: (trialId, basis) => {
    set((state) => {
      const params = state.analysisParams;
      return {
        trials: patchTrial(state.trials, trialId, (t) => {
          const withBasis = { ...t, measurementBasis: basis };
          return t.events ? redetectEventsForTrial(withBasis, params) : withBasis;
        }),
        statusMessage: `Measurement basis set to ${basis} — events re-detected.`,
      };
    });
    scheduleSave(get, set);
  },

  confirmEvent: (trialId, eventId) => {
    set((state) => ({
      trials: patchTrial(state.trials, trialId, (t) => {
        if (!t.events) return t;
        const events = {
          ...t.events,
          events: t.events.events.map((e) =>
            e.id === eventId ? { ...e, status: 'confirmed' as const } : e,
          ),
        };
        return recomputeMeasuresForTrial({ ...t, events }, state.analysisParams);
      }),
      statusMessage: 'Event confirmed.',
    }));
    scheduleSave(get, set);
  },

  rejectEvent: (trialId, eventId) => {
    set((state) => ({
      trials: patchTrial(state.trials, trialId, (t) => {
        if (!t.events) return t;
        const events = {
          ...t.events,
          events: t.events.events.map((e) =>
            e.id === eventId ? { ...e, status: 'rejected' as const } : e,
          ),
        };
        return recomputeMeasuresForTrial({ ...t, events }, state.analysisParams);
      }),
      statusMessage: 'Event rejected.',
    }));
    scheduleSave(get, set);
  },

  updateEventParams: (patch) => {
    set((state) => {
      const events = { ...state.analysisParams.events, ...patch };
      const analysisParams = { ...state.analysisParams, events, updatedAt: new Date().toISOString() };
      const trials = state.trials.map((t) =>
        t.events ? redetectEventsForTrial(t, analysisParams) : t,
      );
      return { trials, analysisParams, statusMessage: 'Event parameters updated — re-detected.' };
    });
    scheduleSave(get, set);
  },

  updateOperationalDefinitions: (patch) => {
    set((state) => {
      const operationalDefinitions = {
        ...state.analysisParams.operationalDefinitions,
        ...patch,
      };
      const analysisParams = {
        ...state.analysisParams,
        operationalDefinitions,
        updatedAt: new Date().toISOString(),
      };
      const trials = state.trials.map((t) =>
        t.events ? recomputeMeasuresForTrial(t, analysisParams) : t,
      );
      return { trials, analysisParams };
    });
    scheduleSave(get, set);
  },
}));

if (typeof window !== 'undefined') {
  type NeuroTrackTestHooks = Window & {
    __ntApplyBodyCorrection?: (trialId: string, frameIndex: number, x: number, y: number) => void;
    __ntPreviewCleaning?: (trialId: string) => number;
    __ntApplyCleaning?: (trialId: string) => boolean;
    __ntDiscardCleaningPreview?: (trialId: string) => boolean;
    __ntGetManualBodyAt?: (
      trialId: string,
      frameIndex: number,
    ) => { x: number; y: number } | null;
    __ntResetManualCorrection?: (trialId: string, frameIndex: number) => void;
    __ntGetEffectiveOriginAt?: (trialId: string, frameIndex: number) => string | null;
    __ntUpdateCleaningParams?: (patch: { maxGapFrames?: number; smoothingWindow?: number; maxGapDurationUs?: number }) => void;
    __ntIsAppliedCleaningStale?: (trialId: string) => boolean;
    __ntDetectEvents?: (trialId: string) => Promise<boolean>;
    __ntGetMeasuresText?: (trialId: string) => string | null;
    __ntSetMeasurementBasis?: (trialId: string, basis: string) => void;
    __ntUpdateEventParams?: (patch: { investigationMinDwellUs?: number }) => void;
  };
  const hooks = window as NeuroTrackTestHooks;
  hooks.__ntApplyBodyCorrection = (trialId, frameIndex, x, y) => {
    useSessionStore.getState().applyManualBodyCorrection(trialId, frameIndex, x, y);
  };
  hooks.__ntPreviewCleaning = (trialId) => {
    useSessionStore.getState().previewCleaning(trialId);
    return useSessionStore.getState().cleaningPreviewByTrialId[trialId]?.length ?? 0;
  };
  hooks.__ntApplyCleaning = (trialId) => {
    useSessionStore.getState().applyCleaning(trialId);
    const trial = useSessionStore.getState().trials.find((t) => t.id === trialId);
    return trial?.track?.appliedCleaning != null && !trial.track.appliedCleaning.stale;
  };
  hooks.__ntDiscardCleaningPreview = (trialId) => {
    useSessionStore.getState().discardCleaningPreview(trialId);
    return useSessionStore.getState().cleaningPreviewByTrialId[trialId] == null;
  };
  hooks.__ntGetManualBodyAt = (trialId, frameIndex) => {
    const trial = useSessionStore.getState().trials.find((t) => t.id === trialId);
    const correction = trial?.track?.manualCorrections.find((c) => c.frameIndex === frameIndex);
    return correction?.bodyXY ?? null;
  };
  hooks.__ntResetManualCorrection = (trialId, frameIndex) => {
    useSessionStore.getState().resetManualCorrection(trialId, frameIndex);
  };
  hooks.__ntGetEffectiveOriginAt = (trialId, frameIndex) => {
    const state = useSessionStore.getState();
    const trial = state.trials.find((t) => t.id === trialId);
    if (!trial?.track) return null;
    const effective = resolveEffectiveObservations(trial.track, {
      cleaningPreview: state.cleaningPreviewByTrialId[trialId] ?? null,
    });
    return effective.find((o) => o.frameIndex === frameIndex)?.origin ?? null;
  };
  hooks.__ntUpdateCleaningParams = (patch) => {
    useSessionStore.getState().updateCleaningParams(patch);
  };
  hooks.__ntIsAppliedCleaningStale = (trialId) => {
    const trial = useSessionStore.getState().trials.find((t) => t.id === trialId);
    return Boolean(trial?.track?.appliedCleaning?.stale);
  };
  hooks.__ntDetectEvents = async (trialId) => {
    await useSessionStore.getState().detectEvents(trialId);
    const trial = useSessionStore.getState().trials.find((t) => t.id === trialId);
    return Boolean(trial?.events?.events.length);
  };
  hooks.__ntGetMeasuresText = (trialId) => {
    const trial = useSessionStore.getState().trials.find((t) => t.id === trialId);
    const m = trial?.measures?.totalLatency;
    if (!m) return null;
    if (m.censored) return `censored:${m.lowerBound ?? 'null'}`;
    return String(m.value);
  };
  hooks.__ntSetMeasurementBasis = (trialId, basis) => {
    useSessionStore.getState().setMeasurementBasis(trialId, basis as 'raw' | 'corrected' | 'cleaned');
  };
  hooks.__ntUpdateEventParams = (patch) => {
    useSessionStore.getState().updateEventParams(patch);
  };
}

export type { Hole };
