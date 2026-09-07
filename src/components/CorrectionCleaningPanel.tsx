import type { TrialRecord } from '../domain/types';
import { resolveEffectiveObservations } from '../domain/trajectory/resolveObservations';
import { useSessionStore, type CorrectionMode } from '../store/sessionStore';
import styles from '../styles/app.module.css';

interface CorrectionCleaningPanelProps {
  trial: TrialRecord;
  currentFrameIndex: number;
}

export function CorrectionCleaningPanel({
  trial,
  currentFrameIndex,
}: CorrectionCleaningPanelProps) {
  const correctionMode = useSessionStore((s) => s.correctionMode);
  const setCorrectionMode = useSessionStore((s) => s.setCorrectionMode);
  const resetManualCorrection = useSessionStore((s) => s.resetManualCorrection);
  const removeManualNoseCorrection = useSessionStore((s) => s.removeManualNoseCorrection);
  const cleaningParams = useSessionStore((s) => s.analysisParams.cleaning);
  const updateCleaningParams = useSessionStore((s) => s.updateCleaningParams);
  const previewCleaning = useSessionStore((s) => s.previewCleaning);
  const applyCleaning = useSessionStore((s) => s.applyCleaning);
  const discardCleaningPreview = useSessionStore((s) => s.discardCleaningPreview);
  const cleaningPreview = useSessionStore((s) => s.cleaningPreviewByTrialId[trial.id] ?? null);

  const track = trial.track;
  const hasTrack = track?.status === 'done' && (track.observations.length ?? 0) > 0;
  const manualCount = track?.manualCorrections.length ?? 0;
  const hasPreview = cleaningPreview != null;
  const hasApplied = track?.appliedCleaning != null;

  const effective = resolveEffectiveObservations(track, { cleaningPreview });
  const currentObs = effective.find((o) => o.frameIndex === currentFrameIndex) ?? null;
  const hasManualOnFrame = track?.manualCorrections.some((c) => c.frameIndex === currentFrameIndex);

  const setMode = (mode: CorrectionMode) => {
    setCorrectionMode(correctionMode === mode ? 'off' : mode);
  };

  if (!hasTrack) {
    return (
      <section className={styles.panel} aria-labelledby="correction-heading">
        <h2 id="correction-heading">Correction &amp; cleaning</h2>
        <p>Run tracking first to enable manual corrections and trajectory cleaning.</p>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="correction-heading">
      <h2 id="correction-heading">Correction &amp; cleaning</h2>

      <div className={styles.actions}>
        <button
          type="button"
          className={correctionMode === 'body' ? styles.buttonPrimary : styles.button}
          onClick={() => setMode('body')}
          data-testid="correction-mode-body"
        >
          {correctionMode === 'body' ? 'Correcting body…' : 'Correct body'}
        </button>
        <button
          type="button"
          className={correctionMode === 'nose' ? styles.buttonPrimary : styles.button}
          onClick={() => setMode('nose')}
          data-testid="correction-mode-nose"
        >
          {correctionMode === 'nose' ? 'Correcting nose…' : 'Correct nose'}
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            removeManualNoseCorrection(trial.id, currentFrameIndex);
            setCorrectionMode('off');
          }}
          data-testid="correction-remove-nose"
        >
          Remove nose
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={!hasManualOnFrame}
          onClick={() => {
            resetManualCorrection(trial.id, currentFrameIndex);
            setCorrectionMode('off');
          }}
          data-testid="correction-reset-frame"
        >
          Reset frame to auto
        </button>
      </div>

      {correctionMode !== 'off' && (
        <p className={styles.hint} data-testid="correction-mode-hint">
          Click the video to place the {correctionMode === 'body' ? 'body' : 'nose'} on frame{' '}
          {currentFrameIndex + 1}.
        </p>
      )}

      <p data-testid="correction-summary">
        {manualCount} manual correction{manualCount === 1 ? '' : 's'}
        {currentObs ? ` · current frame origin: ${currentObs.origin}` : ''}
      </p>

      <ul className={styles.legendList} data-testid="provenance-legend">
        <li><span className={styles.legendAuto} aria-hidden="true" /> Automatic (circle)</li>
        <li><span className={styles.legendManual} aria-hidden="true" /> Manual (square)</li>
        <li><span className={styles.legendInterpolated} aria-hidden="true" /> Interpolated (dashed circle)</li>
        <li><span className={styles.legendSmoothed} aria-hidden="true" /> Smoothed (double circle)</li>
      </ul>

      <h3 className={styles.subheading}>Trajectory cleaning</h3>
      <p className={styles.hint}>
        Preview changes before applying. Manual corrections are never overwritten.
      </p>

      <div className={styles.labelField}>
        <label htmlFor="clean-max-gap">Max gap to fill (frames)</label>
        <input
          id="clean-max-gap"
          type="number"
          min={0}
          max={10}
          value={cleaningParams.maxGapFrames}
          onChange={(e) => updateCleaningParams({ maxGapFrames: Number(e.target.value) })}
          data-testid="clean-max-gap"
        />
      </div>
      <div className={styles.labelField}>
        <label htmlFor="clean-smooth">Smoothing window (frames, odd)</label>
        <input
          id="clean-smooth"
          type="number"
          min={1}
          max={15}
          step={2}
          value={cleaningParams.smoothingWindow}
          onChange={(e) => updateCleaningParams({ smoothingWindow: Number(e.target.value) })}
          data-testid="clean-smoothing-window"
        />
      </div>
      <div className={styles.labelField}>
        <label htmlFor="clean-outlier">Outlier speed multiplier</label>
        <input
          id="clean-outlier"
          type="number"
          min={1}
          max={5}
          step={0.1}
          value={cleaningParams.outlierSpeedMultiplier}
          onChange={(e) =>
            updateCleaningParams({ outlierSpeedMultiplier: Number(e.target.value) })
          }
          data-testid="clean-outlier-mult"
        />
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.buttonPrimary}
          onClick={() => previewCleaning(trial.id)}
          data-testid="clean-preview-btn"
        >
          Preview cleaning
        </button>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={!hasPreview && !hasApplied}
          onClick={() => applyCleaning(trial.id)}
          data-testid="clean-apply-btn"
        >
          Apply cleaning
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={!hasPreview}
          onClick={() => discardCleaningPreview(trial.id)}
          data-testid="clean-discard-btn"
        >
          Discard preview
        </button>
      </div>

      {hasPreview && (
        <p className={styles.warningBox} data-testid="clean-preview-active">
          Preview active — trajectory shows proposed cleaning (not saved until Apply).
        </p>
      )}
      <span
        hidden
        aria-hidden="true"
        data-testid="cleaning-preview-state"
        data-active={hasPreview ? 'true' : 'false'}
      />
      {hasApplied && !hasPreview && (
        <p data-testid="clean-applied-marker">Cleaning applied at {track!.appliedCleaning!.appliedAt}</p>
      )}

      <p className={styles.hint} data-testid="ms5-event-note">
        Manual event editing (hole investigations, escape) requires MS-5 event detection — not
        available in this milestone.
      </p>
    </section>
  );
}
