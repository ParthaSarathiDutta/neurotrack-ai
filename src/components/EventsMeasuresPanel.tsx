import { useSessionStore } from '../store/sessionStore';
import styles from '../styles/app.module.css';
import type { TrialRecord, MeasurementBasis, BehavioralEvent } from '../domain/types';
import { formatPresentationTimeSeconds } from '../domain/timing';

interface EventsMeasuresPanelProps {
  trial: TrialRecord;
  onSeekToFrame: (frameIndex: number) => void;
}

function formatMeasure(m: { value: number | null; unit: string; censored: boolean; unavailable: boolean; lowerBound?: number | null; lowerBoundUnit?: string | null; flags: string[] }): string {
  if (m.unavailable) return 'Unavailable';
  if (m.censored) {
    const lb = m.lowerBound != null ? ` ≥ ${m.lowerBound.toFixed(2)} ${m.lowerBoundUnit ?? m.unit}` : '';
    return `Censored${lb}${m.flags.length ? ` (${m.flags.join(', ')})` : ''}`;
  }
  if (m.value == null) return '—';
  return `${m.value.toFixed(2)} ${m.unit}`;
}

export function EventsMeasuresPanel({ trial, onSeekToFrame }: EventsMeasuresPanelProps) {
  const detectEvents = useSessionStore((s) => s.detectEvents);
  const setMeasurementBasis = useSessionStore((s) => s.setMeasurementBasis);
  const confirmEvent = useSessionStore((s) => s.confirmEvent);
  const rejectEvent = useSessionStore((s) => s.rejectEvent);
  const updateEventParams = useSessionStore((s) => s.updateEventParams);
  const eventsBusy = useSessionStore((s) => s.eventsBusy);

  const basis = trial.measurementBasis ?? 'corrected';
  const analysis = trial.events;
  const measures = trial.measures;
  const canDetect = trial.track?.status === 'done' && Boolean(trial.geometry.confirmedAt);

  const escapeEv = analysis?.events.find(
    (e) => e.type !== 'investigation',
  );

  return (
    <section className={styles.panel} data-testid="events-measures-panel">
      <h3>Events &amp; measures</h3>
      <p className={styles.hint}>
        Operational definitions are versioned recommendations — adjust thresholds to match your protocol.
      </p>

      <div className={styles.actionsRow}>
        <label htmlFor="measurement-basis-select">Measurement basis</label>
        <select
          id="measurement-basis-select"
          data-testid="measurement-basis-select"
          value={basis}
          onChange={(e) => setMeasurementBasis(trial.id, e.target.value as MeasurementBasis)}
        >
          <option value="raw">Raw</option>
          <option value="corrected">Corrected (default)</option>
          <option value="cleaned">Cleaned</option>
        </select>
        <button
          type="button"
          data-testid="detect-events-btn"
          disabled={!canDetect || eventsBusy}
          onClick={() => void detectEvents(trial.id)}
        >
          {eventsBusy ? 'Detecting…' : 'Detect events'}
        </button>
      </div>

      {analysis?.stale && (
        <p className={styles.warning} data-testid="events-stale-banner">
          {analysis.staleReason ?? 'Event analysis stale — re-detect events.'}
        </p>
      )}

      {analysis && (
        <details className={styles.details} data-testid="events-list">
          <summary>Events ({analysis.events.length}) — basis: {analysis.basisUsed}</summary>
          <ul className={styles.flaggedList}>
            {analysis.events.map((ev) => (
              <EventRow
                key={ev.id}
                ev={ev}
                onSeek={() => onSeekToFrame(ev.startFrameIndex)}
                onConfirm={() => confirmEvent(trial.id, ev.id)}
                onReject={() => rejectEvent(trial.id, ev.id)}
              />
            ))}
          </ul>
        </details>
      )}

      {escapeEv && (
        <p data-testid="escape-state-label">
          Escape state: <strong>{escapeEv.type.replace(/_/g, ' ')}</strong>
          {escapeEv.evidence.observedFollowUpLowerBoundUs != null && (
            <> — follow-up lower bound ≥ {formatPresentationTimeSeconds(Number(escapeEv.evidence.observedFollowUpLowerBoundUs))} s</>
          )}
        </p>
      )}

      {measures && (
        <div data-testid="measures-summary">
          <h4>Measures ({measures.basisUsed})</h4>
          <dl className={styles.measureGrid}>
            <MeasureRow label="Primary latency" testId="measure-primary-latency" value={formatMeasure(measures.primaryLatency)} def={measures.primaryLatency.definitionSummary} />
            <MeasureRow label="Total latency" testId="measure-total-latency" value={formatMeasure(measures.totalLatency)} def={measures.totalLatency.definitionSummary} />
            <MeasureRow label="Primary errors (confirmed)" testId="measure-primary-errors" value={formatMeasure(measures.primaryErrors)} def={`Provisional: ${measures.errorCounts.provisional.total}`} />
            <MeasureRow label="Total errors (confirmed)" testId="measure-total-errors" value={formatMeasure(measures.totalErrors)} def={`Provisional: ${measures.totalErrorCounts.provisional.total}`} />
            <MeasureRow label="Path length" testId="measure-path-length" value={formatMeasure(measures.pathLength)} def="" />
            <MeasureRow label="Mean speed" testId="measure-mean-speed" value={formatMeasure(measures.meanSpeed)} def="" />
            <MeasureRow label="Search strategy" testId="measure-search-strategy" value={measures.searchStrategy.override ?? measures.searchStrategy.classification} def={String(measures.searchStrategy.reasoning.classifierVersion ?? '')} />
          </dl>
        </div>
      )}

      <details className={styles.details}>
        <summary>Event thresholds (heuristic v1)</summary>
        <label>
          Min dwell (ms)
          <input
            type="number"
            data-testid="param-investigation-min-dwell-ms"
            value={Math.round((useSessionStore.getState().analysisParams.events.investigationMinDwellUs ?? 400_000) / 1000)}
            onChange={(e) =>
              updateEventParams({ investigationMinDwellUs: Number(e.target.value) * 1000 })
            }
          />
        </label>
      </details>
    </section>
  );
}

function MeasureRow({ label, testId, value, def }: { label: string; testId: string; value: string; def: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd data-testid={testId}>
        {value}
        {def ? <span className={styles.hint}> — {def}</span> : null}
      </dd>
    </>
  );
}

function EventRow({
  ev,
  onSeek,
  onConfirm,
  onReject,
}: {
  ev: BehavioralEvent;
  onSeek: () => void;
  onConfirm: () => void;
  onReject: () => void;
}) {
  return (
    <li data-testid={`event-row-${ev.type}-${ev.holeId ?? 'none'}-${ev.startFrameIndex}`}>
      <button type="button" onClick={onSeek}>
        {ev.type} hole {ev.holeId ?? '—'} frame {ev.startFrameIndex + 1} ({ev.status}, {ev.confidence ?? '—'})
      </button>
      {ev.status === 'proposed' && (
        <>
          <button type="button" data-testid={`confirm-event-${ev.id}`} onClick={onConfirm}>Confirm</button>
          <button type="button" data-testid={`reject-event-${ev.id}`} onClick={onReject}>Reject</button>
        </>
      )}
    </li>
  );
}
