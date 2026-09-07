import { useRef, useState, useCallback, useEffect } from 'react';
import type { TrialRecord } from '../domain/types';
import { resolveEffectiveObservations } from '../domain/trajectory/resolveObservations';
import { getTrialReviewStatus, reviewStatusLabel } from '../domain/migration';
import { VideoPlayer } from './VideoPlayer';
import { CalibrationPanel } from './CalibrationPanel';
import { TrialWindowPanel } from './TrialWindowPanel';
import { TrackQualityPanel } from './TrackQualityPanel';
import { CorrectionCleaningPanel } from './CorrectionCleaningPanel';
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

      <div hidden aria-hidden="true" data-testid="trial-metadata-compat">
        <span data-testid="meta-frame-rate">{meta.containerFrameRateLabel}</span>
        <span data-testid="meta-timescale">{meta.trackTimescale}</span>
        <span data-testid="meta-sample-count">{meta.nbSamples}</span>
        <input data-testid="trial-label-input" value={trial.label} readOnly tabIndex={-1} />
      </div>
    </div>
  );
}
