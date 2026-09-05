import { useId, useRef } from 'react';
import styles from '../styles/app.module.css';
import { fingerprintPrefix } from '../domain/fingerprint';
import type { TrialRecord } from '../domain/types';
import { useSessionStore } from '../store/sessionStore';

function formatSeconds(timeUs: number): string {
  return (timeUs / 1_000_000).toFixed(6);
}

function ingestStatusLabel(status: TrialRecord['ingestStatus']): string {
  switch (status) {
    case 'ready':
      return 'Ready';
    case 'needs_reselect':
      return 'Video file needed';
    case 'error':
      return 'Error';
    case 'indexing':
      return 'Processing';
    default:
      return 'Pending';
  }
}

function videoAvailabilityLabel(trial: TrialRecord): string {
  if (trial.videoCached) return 'Available locally';
  if (trial.metadata) return 'Not cached — re-select file';
  return 'Not loaded';
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
            The video file is no longer stored in this browser. Re-select the same file to
            continue — your trial label and analysis data are preserved.
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

      <table className={styles.metaTable} aria-label="Trial summary">
        <tbody>
          <tr>
            <th scope="row">Filename</th>
            <td>{trial.fileName}</td>
          </tr>
          <tr>
            <th scope="row">Status</th>
            <td>{ingestStatusLabel(trial.ingestStatus)}</td>
          </tr>
          <tr>
            <th scope="row">Video availability</th>
            <td>{videoAvailabilityLabel(trial)}</td>
          </tr>
          {meta && (
            <>
              <tr>
                <th scope="row">Duration</th>
                <td>{meta.durationSec.toFixed(2)} s</td>
              </tr>
              <tr>
                <th scope="row">Resolution</th>
                <td>
                  {meta.codedWidth} × {meta.codedHeight}
                </td>
              </tr>
              <tr data-testid="meta-frame-rate">
                <th scope="row">Frame rate</th>
                <td className={styles.mono}>{meta.containerFrameRateLabel}</td>
              </tr>
              <tr>
                <th scope="row">Frame count</th>
                <td data-testid="meta-sample-count">{meta.nbSamples}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      {(meta || index.length > 0) && (
        <details className={styles.details} data-testid="technical-details">
          <summary>Technical details</summary>
          <table className={styles.metaTable} aria-label="Technical trial metadata">
            <tbody>
              <tr>
                <th scope="row">Fingerprint</th>
                <td className={styles.mono}>{fingerprintPrefix(trial.fingerprint, 16)}…</td>
              </tr>
              {meta && (
                <>
                  <tr>
                    <th scope="row">Codec</th>
                    <td>{meta.codec}</td>
                  </tr>
                  <tr data-testid="meta-timescale">
                    <th scope="row">Track timescale</th>
                    <td>{meta.trackTimescale}</td>
                  </tr>
                  <tr>
                    <th scope="row">Decoder output count</th>
                    <td>{meta.decoderOutputFrames}</td>
                  </tr>
                  <tr>
                    <th scope="row">Median unique CTS delta</th>
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
                    <th scope="row">Timestamp index entries</th>
                    <td>{index.length}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </details>
      )}

      {trial.ingestError && (
        <p className={styles.errorText} role="alert">
          {trial.ingestError}
        </p>
      )}
    </section>
  );
}
