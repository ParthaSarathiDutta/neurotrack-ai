import { useState } from 'react';
import { groupFlaggedFrames } from '../domain/tracking/trackQuality';
import type { FlaggedFrame, TrialRecord } from '../domain/types';
import { canRunTracking } from '../services/trackingService';
import { useSessionStore } from '../store/sessionStore';
import styles from '../styles/app.module.css';

interface TrackQualityPanelProps {
  trial: TrialRecord;
  onSeekToFrame: (frameIndex: number) => void;
}

/** How many frames a category shows before "Show all N" must be clicked. */
const CATEGORY_PAGE_SIZE = 25;

function CategoryFrameList({
  frames,
  onSeekToFrame,
}: {
  frames: FlaggedFrame[];
  onSeekToFrame: (frameIndex: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? frames : frames.slice(0, CATEGORY_PAGE_SIZE);

  return (
    <div>
      <ul className={styles.flaggedFrameList}>
        {visible.map((f) => (
          <li key={`${f.frameIndex}-${f.reason}`}>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => onSeekToFrame(f.frameIndex)}
              data-testid={`flagged-frame-${f.frameIndex}`}
            >
              Frame {f.frameIndex + 1} ({(f.timeUs / 1_000_000).toFixed(3)} s)
            </button>
          </li>
        ))}
      </ul>
      {!expanded && frames.length > CATEGORY_PAGE_SIZE && (
        <button
          type="button"
          className={styles.button}
          onClick={() => setExpanded(true)}
          data-testid="expand-category-btn"
        >
          Show all {frames.length} frames
        </button>
      )}
    </div>
  );
}

export function TrackQualityPanel({ trial, onSeekToFrame }: TrackQualityPanelProps) {
  const runTracking = useSessionStore((s) => s.runTracking);
  const cancelTracking = useSessionStore((s) => s.cancelTracking);
  const trackingBusy = useSessionStore((s) => s.trackingBusy);
  const trackingProgress = useSessionStore((s) => s.trackingProgress);

  const gate = canRunTracking(trial);
  const track = trial.track;
  const quality = track?.quality;
  const categories = quality ? groupFlaggedFrames(quality.flaggedFrames) : [];

  const progressPct =
    trackingProgress && trackingProgress.total > 0
      ? Math.round((trackingProgress.framesProcessed / trackingProgress.total) * 100)
      : 0;

  return (
    <section className={styles.panel} aria-labelledby="tracking-heading">
      <h2 id="tracking-heading">Tracking &amp; quality</h2>

      {!gate.ok && (
        <p className={styles.hint} data-testid="tracking-gate-message">
          {gate.reason}
        </p>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={!gate.ok || trackingBusy}
          onClick={() => void runTracking(trial.id)}
          data-testid="run-tracking-btn"
        >
          {trackingBusy ? 'Tracking…' : 'Run tracking'}
        </button>
        {trackingBusy && (
          <button
            type="button"
            className={styles.button}
            onClick={() => cancelTracking(trial.id)}
            data-testid="cancel-tracking-btn"
          >
            Cancel
          </button>
        )}
      </div>

      {trackingBusy && trackingProgress && (
        <div data-testid="tracking-progress">
          <p>
            {trackingProgress.phase === 'background' ? 'Building background model' : 'Tracking frames'}:{' '}
            {trackingProgress.framesProcessed}/{trackingProgress.total} ({progressPct}%)
          </p>
          <progress max={100} value={progressPct} aria-label="Tracking progress" />
        </div>
      )}

      {track?.status === 'failed' && track.error && (
        <div className={styles.warningBox} role="alert" data-testid="tracking-error">
          {track.error}
        </div>
      )}

      {track?.status === 'cancelled' && (
        <p data-testid="tracking-cancelled">Tracking was cancelled.</p>
      )}

      {quality && (
        <>
          <p data-testid="tracking-summary">
            Tracked {(quality.trackedFraction * 100).toFixed(1)}% of in-trial frames (
            {quality.trackedCount} tracked, {quality.lostCount} lost,{' '}
            {quality.absentInHoleCount} provisional hole-absence). Quality:{' '}
            <strong data-testid="tracking-assessment">{quality.overallAssessment}</strong>
          </p>

          {quality.overallAssessment !== 'high' && quality.assessmentReasons.length > 0 && (
            <div
              className={styles.warningBox}
              role="status"
              data-testid="tracking-quality-warning"
            >
              <ul>
                {quality.assessmentReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          <details className={styles.details} data-testid="tracking-technical-details">
            <summary>Technical details</summary>
            <table className={styles.metricsTable}>
              <tbody>
                <tr>
                  <th scope="row">Mean confidence</th>
                  <td data-testid="tracking-mean-confidence">
                    {quality.meanConfidence.toFixed(3)} (relative plausibility, not calibrated probability)
                  </td>
                </tr>
                <tr>
                  <th scope="row">Median confidence</th>
                  <td data-testid="tracking-median-confidence">
                    {quality.medianConfidence.toFixed(3)}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Longest lost gap</th>
                  <td data-testid="tracking-longest-gap">
                    {quality.longestLostGapFrames} frames ({(quality.longestLostGapUs / 1_000_000).toFixed(3)} s)
                  </td>
                </tr>
                <tr>
                  <th scope="row">Low-confidence frames</th>
                  <td data-testid="tracking-low-confidence-count">{quality.lowConfidenceCount}</td>
                </tr>
                <tr>
                  <th scope="row">Speed outliers</th>
                  <td data-testid="tracking-speed-outlier-count">{quality.speedOutlierCount}</td>
                </tr>
                <tr>
                  <th scope="row">Flagged for review</th>
                  <td data-testid="tracking-flagged-count">{quality.flaggedFrames.length}</td>
                </tr>
              </tbody>
            </table>
            <p className={styles.hint}>
              Provisional <code>absent_in_hole</code> statuses are per-frame hypotheses only — not
              confirmed escape events (MS-5).
            </p>
          </details>

          <div data-testid="flagged-review-categories">
            <h3>Frames requiring review, by category</h3>
            <p className={styles.hint}>
              Each category lists every matching frame — a busy category never hides frames from
              a rarer one. Click a frame to seek the player to it exactly.
            </p>
            {categories.map((cat) => (
              <details
                key={cat.key}
                className={styles.details}
                data-testid={`flagged-category-${cat.key}`}
                open={cat.frames.length > 0 && cat.frames.length <= CATEGORY_PAGE_SIZE}
              >
                <summary data-testid={`flagged-category-summary-${cat.key}`}>
                  {cat.label} ({cat.frames.length})
                </summary>
                {cat.frames.length > 0 ? (
                  <CategoryFrameList frames={cat.frames} onSeekToFrame={onSeekToFrame} />
                ) : (
                  <p className={styles.hint}>No frames in this category.</p>
                )}
              </details>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
