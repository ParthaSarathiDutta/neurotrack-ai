import type { TrialRecord } from '../domain/types';
import { canRunTracking } from '../services/trackingService';
import { useSessionStore } from '../store/sessionStore';
import styles from '../styles/app.module.css';

interface TrackQualityPanelProps {
  trial: TrialRecord;
  onSeekToFrame: (frameIndex: number) => void;
}

export function TrackQualityPanel({ trial, onSeekToFrame }: TrackQualityPanelProps) {
  const runTracking = useSessionStore((s) => s.runTracking);
  const cancelTracking = useSessionStore((s) => s.cancelTracking);
  const trackingBusy = useSessionStore((s) => s.trackingBusy);
  const trackingProgress = useSessionStore((s) => s.trackingProgress);

  const gate = canRunTracking(trial);
  const track = trial.track;
  const quality = track?.quality;

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

          {quality.flaggedFrames.length > 0 && (
            <div data-testid="flagged-frames-list">
              <h3>Frames requiring review</h3>
              <ul className={styles.flaggedFrameList}>
                {quality.flaggedFrames.slice(0, 50).map((f) => (
                  <li key={`${f.frameIndex}-${f.reason}`}>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => onSeekToFrame(f.frameIndex)}
                      data-testid={`flagged-frame-${f.frameIndex}`}
                    >
                      Frame {f.frameIndex + 1} — {f.reason.replace(/_/g, ' ')}
                    </button>
                  </li>
                ))}
              </ul>
              {quality.flaggedFrames.length > 50 && (
                <p>…and {quality.flaggedFrames.length - 50} more (see Technical details).</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
