import type { TrialRecord } from '../domain/types';
import { secondsFromTimeUs } from '../domain/timing';
import { useSessionStore } from '../store/sessionStore';
import styles from '../styles/app.module.css';

interface TrialWindowPanelProps {
  trial: TrialRecord;
}

export function TrialWindowPanel({ trial }: TrialWindowPanelProps) {
  const proposeWindow = useSessionStore((s) => s.proposeWindow);
  const confirmTrialWindow = useSessionStore((s) => s.confirmTrialWindow);
  const updateTrialWindow = useSessionStore((s) => s.updateTrialWindow);
  const calibrationBusy = useSessionStore((s) => s.calibrationBusy);

  const tw = trial.trialWindow;
  const durationSec = trial.metadata?.durationSec ?? 0;

  const startSec = tw.startTimeUs != null ? secondsFromTimeUs(tw.startTimeUs) : null;
  const endSec = tw.endTimeUs != null ? secondsFromTimeUs(tw.endTimeUs) : null;
  const proposedStartSec =
    tw.proposedStartTimeUs != null ? secondsFromTimeUs(tw.proposedStartTimeUs) : null;

  return (
    <section className={styles.panel} aria-labelledby="window-heading">
      <h2 id="window-heading">Trial window</h2>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={calibrationBusy || !trial.videoCached}
          onClick={() => void proposeWindow(trial.id)}
          data-testid="propose-window-btn"
        >
          {calibrationBusy ? 'Detecting…' : 'Detect trial start'}
        </button>
      </div>

      {proposedStartSec != null && (
        <p data-testid="proposed-start">
          Proposed start: {proposedStartSec.toFixed(2)} s
          {tw.source === 'auto' && !tw.confirmedAt ? ' (auto)' : ''}
        </p>
      )}

      <div className={styles.labelField}>
        <label htmlFor="start-sec">Trial start (s)</label>
        <input
          id="start-sec"
          type="number"
          min={0}
          step={0.001}
          value={startSec ?? ''}
          onChange={(e) => {
            const sec = parseFloat(e.target.value);
            if (!Number.isNaN(sec)) {
              updateTrialWindow(trial.id, { startTimeUs: Math.round(sec * 1_000_000) });
            }
          }}
          data-testid="start-time-input"
        />
      </div>

      <div className={styles.labelField}>
        <label htmlFor="end-sec">Trial end (s)</label>
        <input
          id="end-sec"
          type="number"
          min={0}
          step={0.001}
          value={endSec ?? durationSec}
          onChange={(e) => {
            const sec = parseFloat(e.target.value);
            if (!Number.isNaN(sec)) {
              updateTrialWindow(trial.id, { endTimeUs: Math.round(sec * 1_000_000) });
            }
          }}
          data-testid="end-time-input"
        />
      </div>

      <div className={styles.labelField}>
        <label htmlFor="cutoff-sec">Protocol cutoff from start (s)</label>
        <input
          id="cutoff-sec"
          type="number"
          min={1}
          step={1}
          value={tw.cutoffSeconds ?? 180}
          onChange={(e) => {
            const sec = parseFloat(e.target.value);
            if (!Number.isNaN(sec)) {
              updateTrialWindow(trial.id, { cutoffSeconds: sec });
            }
          }}
          data-testid="cutoff-input"
        />
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={tw.startTimeUs == null}
          onClick={() => confirmTrialWindow(trial.id)}
          data-testid="confirm-window-btn"
        >
          Confirm trial window
        </button>
        {tw.confirmedAt && (
          <span className={styles.confirmedMarker} data-testid="window-confirmed">
            Window confirmed
          </span>
        )}
      </div>

      <details className={styles.details} data-testid="window-technical-details">
        <summary>Technical details</summary>
        <table className={styles.metaTable}>
          <tbody>
            <tr>
              <th scope="row">Proposed start (timeUs)</th>
              <td className={styles.mono}>{tw.proposedStartTimeUs ?? '—'}</td>
            </tr>
            <tr>
              <th scope="row">Confirmed start (timeUs)</th>
              <td className={styles.mono}>{tw.startTimeUs ?? '—'}</td>
            </tr>
            <tr>
              <th scope="row">Motion onset confidence</th>
              <td>{tw.motionOnsetConfidence?.toFixed(3) ?? '—'}</td>
            </tr>
            <tr>
              <th scope="row">Source</th>
              <td>{tw.source}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </section>
  );
}
