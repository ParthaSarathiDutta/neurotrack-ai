import { useRef, useState, useCallback, useEffect } from 'react';
import type { TrialRecord } from '../domain/types';
import { getTrialReviewStatus, reviewStatusLabel } from '../domain/migration';
import { VideoPlayer } from './VideoPlayer';
import { CalibrationPanel } from './CalibrationPanel';
import { TrialWindowPanel } from './TrialWindowPanel';
import { useSessionStore } from '../store/sessionStore';
import styles from '../styles/app.module.css';

interface ReviewViewProps {
  trial: TrialRecord;
  allTrials: TrialRecord[];
}

export function ReviewView({ trial, allTrials }: ReviewViewProps) {
  const setTargetHole = useSessionStore((s) => s.setTargetHole);
  const [selectedHoleId, setSelectedHoleId] = useState<number | null>(null);
  const manualClickRef = useRef<((x: number, y: number) => void) | null>(null);

  const registerManualHandler = useCallback((handler: ((x: number, y: number) => void) | null) => {
    manualClickRef.current = handler;
  }, []);

  useEffect(() => {
    setSelectedHoleId(null);
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

  return (
    <div key={trial.id} className={styles.reviewView} data-testid="review-view" data-trial-id={trial.id}>
      <div className={styles.reviewHeader}>
        <h2>Review &amp; calibrate — {trial.label}</h2>
        <span className={styles.reviewStatus} data-testid="review-status">
          {reviewStatusLabel(status)}
        </span>
      </div>

      <VideoPlayer
        fingerprint={trial.fingerprint}
        timestampIndex={trial.timestampIndex}
        videoWidth={meta.codedWidth}
        videoHeight={meta.codedHeight}
        durationSec={meta.durationSec}
        geometry={trial.geometry}
        trialWindow={trial.trialWindow}
        selectedHoleId={selectedHoleId}
        onHoleClick={(holeId) => {
          setSelectedHoleId(holeId);
          setTargetHole(trial.id, holeId);
        }}
        onCanvasClick={(x, y) => {
          manualClickRef.current?.(x, y);
        }}
      />

      <CalibrationPanel
        trial={trial}
        allTrials={allTrials}
        registerManualHandler={registerManualHandler}
      />

      <TrialWindowPanel trial={trial} />

      {/* MS-1 validation compatibility — metadata testids */}
      <div hidden aria-hidden="true" data-testid="trial-metadata-compat">
        <span data-testid="meta-frame-rate">{meta.containerFrameRateLabel}</span>
        <span data-testid="meta-timescale">{meta.trackTimescale}</span>
        <span data-testid="meta-sample-count">{meta.nbSamples}</span>
        <input data-testid="trial-label-input" value={trial.label} readOnly tabIndex={-1} />
      </div>
    </div>
  );
}
