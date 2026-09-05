import { useId, useRef } from 'react';
import styles from '../styles/app.module.css';
import { fingerprintPrefix } from '../domain/fingerprint';
import type { TrialRecord } from '../domain/types';
import { useSessionStore } from '../store/sessionStore';

function formatSeconds(timeUs: number): string {
  return (timeUs / 1_000_000).toFixed(6);
}

interface TrialDetailPanelProps {
  trial: TrialRecord;
}

export function TrialDetailPanel({ trial }: TrialDetailPanelProps) {
  const updateTrialLabel = useSessionStore((s) => s.updateTrialLabel);
  const reselectFile = useSessionStore((s) => s.reselectFile);
  const ingestBusy = useSessionStore((s) => s.ingestBusy);
  const reselectInputId = useId();
  const reselectRef = useRef<HTMLInputElement>(null);

  const meta = trial.metadata;
  const index = trial.timestampIndex;

  return (
    <section className={styles.panel} aria-labelledby="detail-heading">
      <h2 id="detail-heading">Trial details</h2>

      <div className={styles.labelField}>
        <label htmlFor={`label-${trial.id}`}>Trial label</label>
        <input
          id={`label-${trial.id}`}
          type="text"
          value={trial.label}
          data-testid="trial-label-input"
          onChange={(e) => updateTrialLabel(trial.id, e.target.value)}
        />
      </div>

      {trial.ingestStatus === 'needs_reselect' && (
        <div className={styles.warningBox} role="status">
          <p>
            The video file is no longer cached locally. Re-select the same file to continue —
            saved metadata and timestamp index are preserved.
          </p>
          <label htmlFor={reselectInputId} className={styles.button}>
            Re-select video file
          </label>
          <input
            ref={reselectRef}
            id={reselectInputId}
            className={styles.hiddenInput}
            type="file"
            accept="video/mp4,video/*"
            disabled={ingestBusy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void reselectFile(trial.id, file);
              e.target.value = '';
            }}
          />
        </div>
      )}

      <table className={styles.metaTable}>
        <tbody>
          <tr>
            <th scope="row">Fingerprint</th>
            <td className={styles.mono}>{fingerprintPrefix(trial.fingerprint, 16)}…</td>
          </tr>
          <tr>
            <th scope="row">Video cached</th>
            <td>{trial.videoCached ? 'Yes' : 'No'}</td>
          </tr>
          <tr>
            <th scope="row">Ingest status</th>
            <td>{trial.ingestStatus}</td>
          </tr>
          {meta && (
            <>
              <tr>
                <th scope="row">Codec</th>
                <td>{meta.codec}</td>
              </tr>
              <tr>
                <th scope="row">Dimensions</th>
                <td>
                  {meta.codedWidth}×{meta.codedHeight}
                </td>
              </tr>
              <tr data-testid="meta-frame-rate">
                <th scope="row">Container frame rate</th>
                <td className={styles.mono}>{meta.containerFrameRateLabel}</td>
              </tr>
              <tr data-testid="meta-timescale">
                <th scope="row">Track timescale</th>
                <td>{meta.trackTimescale}</td>
              </tr>
              <tr>
                <th scope="row">Duration</th>
                <td>{meta.durationSec.toFixed(3)} s</td>
              </tr>
              <tr>
                <th scope="row">Sample count</th>
                <td data-testid="meta-sample-count">{meta.nbSamples}</td>
              </tr>
              <tr>
                <th scope="row">Decoder outputs</th>
                <td>{meta.decoderOutputFrames}</td>
              </tr>
              <tr>
                <th scope="row">Median unique CTS Δ</th>
                <td>{meta.medianUniqueCtsDelta ?? '—'} ticks</td>
              </tr>
              {meta.frameCountWarning && (
                <tr>
                  <th scope="row">Frame count note</th>
                  <td>{meta.frameCountWarning}</td>
                </tr>
              )}
            </>
          )}
          {index.length > 0 && (
            <>
              <tr>
                <th scope="row">First timestamp (timeUs)</th>
                <td className={styles.mono}>{index[0].timeUs}</td>
              </tr>
              <tr>
                <th scope="row">First timestamp (s)</th>
                <td className={styles.mono}>{formatSeconds(index[0].timeUs)}</td>
              </tr>
              <tr>
                <th scope="row">Last timestamp (s)</th>
                <td className={styles.mono}>{formatSeconds(index[index.length - 1].timeUs)}</td>
              </tr>
              <tr>
                <th scope="row">Index entries</th>
                <td>{index.length}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      {trial.ingestError && (
        <p role="alert" style={{ color: 'var(--color-error)' }}>
          {trial.ingestError}
        </p>
      )}
    </section>
  );
}
