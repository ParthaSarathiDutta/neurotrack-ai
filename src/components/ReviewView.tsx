import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import type { TrialRecord } from '../domain/types';
import { applyManualCorrections } from '../domain/trajectory/manualCorrection';
import {
  compareCleaningPreviewFrame,
} from '../domain/trajectory/cleaningPreviewCompare';
import { resolveEffectiveObservations } from '../domain/trajectory/resolveObservations';
import { resolveMeasurementObservations } from '../domain/trajectory/measurementObservations';
import { effectiveTrialStartUs, censorBoundaryTimeUs } from '../domain/events/holeProximity';
import { getTrialReviewStatus, reviewStatusLabel } from '../domain/migration';
import { VideoPlayer } from './VideoPlayer';
import { CalibrationPanel } from './CalibrationPanel';
import { TrialWindowPanel } from './TrialWindowPanel';
import { TrackQualityPanel } from './TrackQualityPanel';
import { CorrectionCleaningPanel } from './CorrectionCleaningPanel';
import { EventsMeasuresPanel } from './EventsMeasuresPanel';
import { ResultsExportPanel } from './ResultsExportPanel';
import { TrialVisualizationsPanel } from './TrialVisualizationsPanel';
import { useSessionStore } from '../store/sessionStore';
import styles from '../styles/app.module.css';

interface ReviewViewProps {
  trial: TrialRecord;
  allTrials: TrialRecord[];
}

export function ReviewView({ trial, allTrials }: ReviewViewProps) {
  const setTargetHole = useSessionStore((s) => s.setTargetHole);
  const correctionMode = useSessionStore((s) => s.correctionMode);
  const applyManualBodyCorrection = useSessionStore((s) => s.applyManualBodyCorrection);
  const applyManualNoseCorrection = useSessionStore((s) => s.applyManualNoseCorrection);
  const cleaningPreview = useSessionStore((s) => s.cleaningPreviewByTrialId[trial.id] ?? null);
  const cleaningParams = useSessionStore((s) => s.analysisParams.cleaning);
  const [selectedHoleId, setSelectedHoleId] = useState<number | null>(null);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const manualClickRef = useRef<((x: number, y: number) => void) | null>(null);
  const seekApiRef = useRef<{ loadFrame: (i: number) => void } | null>(null);

  const registerManualHandler = useCallback((handler: ((x: number, y: number) => void) | null) => {
    manualClickRef.current = handler;
  }, []);

  const handleSeekToFrame = useCallback((frameIndex: number) => {
    seekApiRef.current?.loadFrame(frameIndex);
  }, []);

  const registerSeekApi = useCallback(
    (api: { loadFrame: (i: number) => void }) => {
      seekApiRef.current = api;
      const hooks = window as Window & { __ntSeekFrame?: (frameIndex: number) => void };
      hooks.__ntSeekFrame = (frameIndex: number) => api.loadFrame(frameIndex);
    },
    [],
  );

  useEffect(() => {
    return () => {
      const hooks = window as Window & { __ntSeekFrame?: (frameIndex: number) => void };
      delete hooks.__ntSeekFrame;
    };
  }, [trial.id]);

  useEffect(() => {
    setSelectedHoleId(null);
    setCurrentFrameIndex(0);
  }, [trial.id]);

  const correctedBase = useMemo(
    () =>
      trial.track?.observations?.length
        ? applyManualCorrections(trial.track.observations, trial.track.manualCorrections ?? [])
        : [],
    [trial.track?.observations, trial.track?.manualCorrections],
  );
  const previewFrameCompare = useMemo(() => {
    if (!cleaningPreview?.length || !trial.track) return null;
    return compareCleaningPreviewFrame(
      correctedBase,
      cleaningPreview,
      trial.track.manualCorrections ?? [],
      currentFrameIndex,
      cleaningParams,
    );
  }, [cleaningPreview, correctedBase, trial.track, currentFrameIndex, cleaningParams]);
  const previewRawBodyXY =
    previewFrameCompare?.meaningfulChange && previewFrameCompare.rawBody
      ? previewFrameCompare.rawBody
      : null;

  const measurementResolved = useMemo(
    () => resolveMeasurementObservations(trial.track, trial.measurementBasis ?? 'corrected'),
    [trial.track, trial.measurementBasis],
  );
  const trialStartUs = effectiveTrialStartUs(trial.trialWindow);
  const censorUs = censorBoundaryTimeUs(trial.trialWindow, trial.timestampIndex);

  if (!trial.metadata || !trial.videoCached) {
    return (
      <section className={styles.panel} data-testid="review-view">
        <h2>Review &amp; calibrate</h2>
        <p>Video must be loaded and cached to review this trial.</p>
      </section>
    );
  }

  const status = getTrialReviewStatus(trial);
  const meta = trial.metadata;
  const effectiveObservations = resolveEffectiveObservations(trial.track, { cleaningPreview });

  const handleCanvasClick = (x: number, y: number) => {
    if (correctionMode === 'body') {
      applyManualBodyCorrection(trial.id, currentFrameIndex, x, y);
      return;
    }
    if (correctionMode === 'nose') {
      applyManualNoseCorrection(trial.id, currentFrameIndex, x, y);
      return;
    }
    manualClickRef.current?.(x, y);
  };

  return (
    <div key={trial.id} className={styles.reviewView} data-testid="review-view" data-trial-id={trial.id}>
      <div className={styles.reviewHeader}>
        <h2>Review &amp; calibrate — {trial.label}</h2>
        <span className={styles.reviewStatus} data-testid="review-status">
          {reviewStatusLabel(status)}
        </span>
      </div>

      <VideoPlayer
        key={trial.fingerprint}
        fingerprint={trial.fingerprint}
        timestampIndex={trial.timestampIndex}
        videoWidth={meta.codedWidth}
        videoHeight={meta.codedHeight}
        durationSec={meta.durationSec}
        geometry={trial.geometry}
        trialWindow={trial.trialWindow}
        observations={effectiveObservations}
        trajectoryObservations={measurementResolved.observations}
        trajectoryTrialStartUs={trialStartUs}
        trajectoryCensorUs={censorUs}
        behavioralEvents={trial.events?.events ?? []}
        previewRawBodyXY={previewRawBodyXY}
        selectedHoleId={selectedHoleId}
        onFrameIndexChange={setCurrentFrameIndex}
        onRegisterSeek={registerSeekApi}
        onHoleClick={(holeId) => {
          setSelectedHoleId(holeId);
          setTargetHole(trial.id, holeId);
        }}
        onCanvasClick={handleCanvasClick}
      />

      <CalibrationPanel
        trial={trial}
        allTrials={allTrials}
        registerManualHandler={registerManualHandler}
      />

      <TrialWindowPanel trial={trial} />

      <TrackQualityPanel trial={trial} onSeekToFrame={handleSeekToFrame} />

      <CorrectionCleaningPanel trial={trial} currentFrameIndex={currentFrameIndex} />

      <EventsMeasuresPanel trial={trial} onSeekToFrame={handleSeekToFrame} currentFrameIndex={currentFrameIndex} />

      <ResultsExportPanel trial={trial} allTrials={allTrials} />

      <TrialVisualizationsPanel
        trial={trial}
        onSeekToFrame={handleSeekToFrame}
        showTrajectoryHint
      />

      <div hidden aria-hidden="true" data-testid="trial-metadata-compat">
        <span data-testid="meta-frame-rate">{meta.containerFrameRateLabel}</span>
        <span data-testid="meta-timescale">{meta.trackTimescale}</span>
        <span data-testid="meta-sample-count">{meta.nbSamples}</span>
        <input data-testid="trial-label-input" value={trial.label} readOnly tabIndex={-1} />
      </div>
    </div>
  );
}
