import type { TrialRecord } from '../domain/types';
import { isAppliedCleaningConsumable } from '../domain/trajectory/cleaningStaleness';
import { isEstimatedBodyPosition } from '../domain/trajectory/observationEstimate';
import {
  compareCleaningPreviewFrame,
  compareCleaningAppliedFrame,
  formatCleaningPreviewCompareLine,
  formatCleaningAppliedCompareLine,
} from '../domain/trajectory/cleaningPreviewCompare';
import {
  applyManualCorrections,
  canRemoveNoseEstimate,
  getManualCorrection,
} from '../domain/trajectory/manualCorrection';
import { formatCleaningQualityFlags } from '../domain/trajectory/cleaningLabels';
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
  const appliedCleaning = track?.appliedCleaning ?? null;
  const hasActiveApplied = isAppliedCleaningConsumable(appliedCleaning);
  const appliedStale = Boolean(appliedCleaning?.stale);

  const effective = resolveEffectiveObservations(track, { cleaningPreview });
  const correctedBase = track?.observations?.length
    ? applyManualCorrections(track.observations, track.manualCorrections ?? [])
    : [];
  const previewCompare =
    hasPreview && track
      ? compareCleaningPreviewFrame(
          correctedBase,
          cleaningPreview!,
          track.manualCorrections ?? [],
          currentFrameIndex,
          cleaningParams,
        )
      : null;
  const appliedCompare =
    hasActiveApplied && !hasPreview && appliedCleaning
      ? compareCleaningAppliedFrame(
          correctedBase,
          appliedCleaning,
          track?.manualCorrections ?? [],
          currentFrameIndex,
          appliedCleaning.params,
        )
      : null;
  const currentObs = effective.find((o) => o.frameIndex === currentFrameIndex) ?? null;
  const hasManualOnFrame = track?.manualCorrections.some((c) => c.frameIndex === currentFrameIndex);
  const rawObs = track?.observations.find((o) => o.frameIndex === currentFrameIndex);
  const manualOnFrame = getManualCorrection(track?.manualCorrections ?? [], currentFrameIndex);
  const canRemoveNose = canRemoveNoseEstimate(rawObs, manualOnFrame ?? undefined);

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
          disabled={!canRemoveNose}
          title={
            canRemoveNose
              ? 'Mark the nose position unavailable on this frame (body unchanged)'
              : 'No nose estimate to mark unavailable on this frame'
          }
          onClick={() => {
            removeManualNoseCorrection(trial.id, currentFrameIndex);
            setCorrectionMode('off');
          }}
          data-testid="correction-remove-nose"
          data-removable={canRemoveNose ? 'true' : 'false'}
        >
          Mark nose unavailable
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

      <p className={styles.hint} data-testid="correction-nose-removal-hint">
        {canRemoveNose
          ? 'Mark nose unavailable hides the nose on this frame without moving the body or deleting the frame. Use Reset frame to auto to restore the automatic nose estimate.'
          : manualOnFrame?.noseXY === null
            ? 'Nose already marked unavailable on this frame. Reset frame to auto restores the automatic estimate.'
            : 'No nose estimate on this frame to mark unavailable.'}
      </p>

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

      {currentObs?.qualityFlags?.length ? (
        <p className={styles.hint} data-testid="observation-quality-flags">
          Frame flags: {formatCleaningQualityFlags(currentObs.qualityFlags)}
        </p>
      ) : null}

      <ul className={styles.legendList} data-testid="provenance-legend">
        <li><span className={styles.legendAuto} aria-hidden="true" /> Automatic (circle)</li>
        <li><span className={styles.legendManual} aria-hidden="true" /> Manual (square)</li>
        <li><span className={styles.legendInterpolated} aria-hidden="true" /> Interpolated (dashed circle)</li>
        <li><span className={styles.legendSmoothed} aria-hidden="true" /> Smoothed (double circle)</li>
        {hasPreview ? (
          <li data-testid="legend-preview-raw">
            Orange hollow ring + connector + &quot;Raw&quot; label — corrected body before preview
            (when shift ≥ 0.5 px)
          </li>
        ) : null}
      </ul>

      <h3 className={styles.subheading}>Trajectory cleaning</h3>
      <p className={styles.hint}>
        Preview changes before applying. Manual corrections are never overwritten. Smoothing may
        shorten path length and soften sharp turns; raw and manually corrected trajectories remain
        available via reset.
      </p>
      <p className={styles.hint} data-testid="duplicate-pts-note">
        When container timestamps duplicate across frames, spatial gap fill uses frame order only —
        never elapsed time or speed. Such points are labeled as spatial estimates.
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
        <label htmlFor="clean-max-gap-us">Max gap bracket span (seconds)</label>
        <input
          id="clean-max-gap-us"
          type="number"
          min={0}
          max={5}
          step={0.05}
          value={(cleaningParams.maxGapDurationUs / 1_000_000).toFixed(2)}
          onChange={(e) =>
            updateCleaningParams({
              maxGapDurationUs: Math.round(Number(e.target.value) * 1_000_000),
            })
          }
          data-testid="clean-max-gap-us"
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
          disabled={!hasPreview && !hasActiveApplied}
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
        <>
          <p className={styles.warningBox} data-testid="clean-preview-active">
            Preview active — compare raw vs proposed cleaning below (not saved until Apply).
          </p>
          {previewCompare ? (
            <p className={styles.hint} data-testid="clean-preview-compare">
              {formatCleaningPreviewCompareLine(previewCompare)}
            </p>
          ) : null}
          {previewCompare?.skipNote ? (
            <p className={styles.hint} data-testid="clean-preview-skip-note">
              {previewCompare.skipNote}
            </p>
          ) : null}
        </>
      )}
      <span
        hidden
        aria-hidden="true"
        data-testid="cleaning-preview-state"
        data-active={hasPreview ? 'true' : 'false'}
      />
      {hasActiveApplied && !hasPreview && (
        <>
          <p data-testid="clean-applied-marker">Cleaning applied at {appliedCleaning!.appliedAt}</p>
          {appliedCompare ? (
            <p className={styles.hint} data-testid="clean-applied-compare">
              {formatCleaningAppliedCompareLine(appliedCompare)}
            </p>
          ) : null}
          {appliedCompare?.unchangedNote ? (
            <p className={styles.hint} data-testid="clean-applied-unchanged">
              {appliedCompare.unchangedNote}
            </p>
          ) : null}
        </>
      )}
      {appliedStale && (
        <p className={styles.warningBox} role="alert" data-testid="clean-stale-marker">
          {appliedCleaning!.staleReason ?? 'Applied cleaning is outdated.'} Preview and re-apply
          before using cleaned trajectories in later analysis.
        </p>
      )}
      <span
        hidden
        aria-hidden="true"
        data-testid="clean-stale-state"
        data-stale={appliedStale ? 'true' : 'false'}
      />
      <span
        hidden
        aria-hidden="true"
        data-testid="observation-estimated"
        data-value={isEstimatedBodyPosition(currentObs) ? 'true' : 'false'}
      />

      <p className={styles.hint}>
        Hole investigations and escape outcomes are edited in the Events &amp; measures panel below the
        player.
      </p>
    </section>
  );
}
