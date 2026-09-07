import { useState } from 'react';
import { useSessionStore } from '../store/sessionStore';
import styles from '../styles/app.module.css';
import type { TrialRecord, MeasurementBasis, BehavioralEvent, EventType } from '../domain/types';
import { formatPresentationTimeSeconds } from '../domain/timing';

interface EventsMeasuresPanelProps {
  trial: TrialRecord;
  onSeekToFrame: (frameIndex: number) => void;
  currentFrameIndex?: number;
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

export function EventsMeasuresPanel({ trial, onSeekToFrame, currentFrameIndex = 0 }: EventsMeasuresPanelProps) {
  const detectEvents = useSessionStore((s) => s.detectEvents);
  const setMeasurementBasis = useSessionStore((s) => s.setMeasurementBasis);
  const confirmEvent = useSessionStore((s) => s.confirmEvent);
  const rejectEvent = useSessionStore((s) => s.rejectEvent);
  const addManualInvestigation = useSessionStore((s) => s.addManualInvestigation);
  const updateEvent = useSessionStore((s) => s.updateEvent);
  const setManualEscapeOutcome = useSessionStore((s) => s.setManualEscapeOutcome);
  const updateEventParams = useSessionStore((s) => s.updateEventParams);
  const eventsBusy = useSessionStore((s) => s.eventsBusy);

  const [manualHoleId, setManualHoleId] = useState('0');
  const [manualStartFrame, setManualStartFrame] = useState('');
  const [manualEndFrame, setManualEndFrame] = useState('');
  const [escapeType, setEscapeType] = useState<Exclude<EventType, 'investigation'>>('escape_incomplete_censored');
  const [escapeHoleId, setEscapeHoleId] = useState('');
  const [escapeEntryFrame, setEscapeEntryFrame] = useState('');

  const basis = trial.measurementBasis ?? 'corrected';
  const analysis = trial.events;
  const measures = trial.measures;
  const canDetect = trial.track?.status === 'done' && Boolean(trial.geometry.confirmedAt);
  const targetConfirmed = Boolean(trial.geometry.targetHoleConfirmedAt);

  const escapeEv = analysis?.events.find((e) => e.type !== 'investigation');
  const pixelComplete = escapeEv?.evidence.pixelEvidenceComplete;
  const pixelAnalyzed = escapeEv?.evidence.pixelFramesAnalyzed;
  const pixelRequested = escapeEv?.evidence.pixelFramesRequested;
  const pixelIncomplete = pixelComplete === false || escapeEv?.evidence.pixel_evidence_incomplete === true;

  return (
    <section className={styles.panel} data-testid="events-measures-panel">
      <h3>Events &amp; measures</h3>
      <p className={styles.hint}>
        Operational definitions are versioned recommendations — adjust thresholds to match your protocol.
      </p>
      {!targetConfirmed && (
        <p className={styles.diagnosticNote} data-testid="target-unknown-note">
          Target hole unknown — target-dependent measures (primary latency, errors, target quadrant) remain unavailable until you confirm the protocol target.
        </p>
      )}

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

      {pixelAnalyzed != null && pixelRequested != null && (
        <p
          className={pixelIncomplete ? styles.pixelEvidenceBanner : styles.hint}
          data-testid="pixel-evidence-banner"
        >
          {pixelIncomplete
            ? `Pixel evidence incomplete — ${pixelAnalyzed}/${pixelRequested} frames analyzed.`
            : `Pixel evidence complete — ${pixelAnalyzed}/${pixelRequested} frames analyzed.`}
        </p>
      )}

      {analysis && (
        <details className={styles.details} open data-testid="events-list">
          <summary>Events ({analysis.events.length}) — basis: {analysis.basisUsed}</summary>
          <ul className={styles.flaggedList}>
            {analysis.events.map((ev) => (
              <EventRow
                key={ev.id}
                ev={ev}
                onSeek={() => onSeekToFrame(ev.startFrameIndex)}
                onConfirm={() => confirmEvent(trial.id, ev.id)}
                onReject={() => rejectEvent(trial.id, ev.id)}
                onEditHole={(holeId) => updateEvent(trial.id, ev.id, { holeId })}
                onEditFrames={(startFrameIndex, endFrameIndex) =>
                  updateEvent(trial.id, ev.id, { startFrameIndex, endFrameIndex })
                }
              />
            ))}
          </ul>
        </details>
      )}

      {escapeEv ? (
        <p data-testid="escape-state-label">
          Escape state: <strong>{escapeEv.type.replace(/_/g, ' ')}</strong>
          {escapeEv.evidence.observedFollowUpLowerBoundUs != null && (
            <> — follow-up lower bound ≥ {formatPresentationTimeSeconds(Number(escapeEv.evidence.observedFollowUpLowerBoundUs))} s</>
          )}
        </p>
      ) : (
        analysis && (
          <p data-testid="escape-state-label">Escape state: <strong>no escape record</strong></p>
        )
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

      {analysis && (
        <details className={styles.details} data-testid="manual-event-form">
          <summary>Add / edit manual events</summary>
          <div className={styles.eventFormRow}>
            <label>
              Investigation hole
              <input
                type="number"
                min={0}
                max={19}
                data-testid="manual-investigation-hole"
                value={manualHoleId}
                onChange={(e) => setManualHoleId(e.target.value)}
              />
            </label>
            <label>
              Start frame
              <input
                type="number"
                min={1}
                data-testid="manual-investigation-start"
                value={manualStartFrame}
                placeholder={String(currentFrameIndex + 1)}
                onChange={(e) => setManualStartFrame(e.target.value)}
              />
            </label>
            <label>
              End frame
              <input
                type="number"
                min={1}
                data-testid="manual-investigation-end"
                value={manualEndFrame}
                placeholder={String(currentFrameIndex + 1)}
                onChange={(e) => setManualEndFrame(e.target.value)}
              />
            </label>
            <button
              type="button"
              data-testid="add-manual-investigation-btn"
              onClick={() => {
                const start = Number(manualStartFrame || currentFrameIndex + 1) - 1;
                const end = Number(manualEndFrame || currentFrameIndex + 1) - 1;
                addManualInvestigation(trial.id, {
                  holeId: Number(manualHoleId),
                  startFrameIndex: start,
                  endFrameIndex: Math.max(start, end),
                });
              }}
            >
              Add investigation
            </button>
          </div>
          <div className={styles.eventFormRow}>
            <label>
              Escape / censor type
              <select
                data-testid="manual-escape-type"
                value={escapeType}
                onChange={(e) => setEscapeType(e.target.value as Exclude<EventType, 'investigation'>)}
              >
                <option value="escape_completed">Escape completed</option>
                <option value="escape_incomplete_censored">Incomplete entry (censored)</option>
                <option value="trial_censored_no_entry">Trial censored — no entry</option>
              </select>
            </label>
            <label>
              Hole (optional)
              <input
                type="number"
                min={0}
                max={19}
                data-testid="manual-escape-hole"
                value={escapeHoleId}
                onChange={(e) => setEscapeHoleId(e.target.value)}
              />
            </label>
            <label>
              Entry onset frame
              <input
                type="number"
                min={1}
                data-testid="manual-escape-entry-frame"
                value={escapeEntryFrame}
                placeholder={String(currentFrameIndex + 1)}
                onChange={(e) => setEscapeEntryFrame(e.target.value)}
              />
            </label>
            <button
              type="button"
              data-testid="set-manual-escape-btn"
              onClick={() =>
                setManualEscapeOutcome(trial.id, {
                  type: escapeType,
                  holeId: escapeHoleId === '' ? null : Number(escapeHoleId),
                  entryOnsetFrameIndex:
                    escapeEntryFrame === '' ? null : Number(escapeEntryFrame) - 1,
                })
              }
            >
              Set escape record
            </button>
          </div>
        </details>
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
        <label>
          Pixel budget (frames)
          <input
            type="number"
            data-testid="param-pixel-budget"
            value={useSessionStore.getState().analysisParams.events.pixelEvidenceBudgetFrames}
            onChange={(e) =>
              updateEventParams({ pixelEvidenceBudgetFrames: Number(e.target.value) })
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
  onEditHole,
  onEditFrames,
}: {
  ev: BehavioralEvent;
  onSeek: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onEditHole: (holeId: number) => void;
  onEditFrames: (start: number, end: number) => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [holeInput, setHoleInput] = useState(String(ev.holeId ?? 0));
  const [startInput, setStartInput] = useState(String(ev.startFrameIndex + 1));
  const [endInput, setEndInput] = useState(String(ev.endFrameIndex + 1));

  return (
    <li data-testid={`event-row-${ev.type}-${ev.holeId ?? 'none'}-${ev.startFrameIndex}`}>
      <button type="button" onClick={onSeek}>
        {ev.type} hole {ev.holeId ?? '—'} frames {ev.startFrameIndex + 1}–{ev.endFrameIndex + 1} ({ev.origin}/{ev.status}, {ev.confidence ?? '—'})
      </button>
      {ev.status === 'proposed' && (
        <>
          <button type="button" data-testid={`confirm-event-${ev.id}`} onClick={onConfirm}>Confirm</button>
          <button type="button" data-testid={`reject-event-${ev.id}`} onClick={onReject}>Reject</button>
        </>
      )}
      {ev.type === 'investigation' && (
        <button type="button" data-testid={`edit-event-${ev.id}`} onClick={() => setEditMode((v) => !v)}>
          {editMode ? 'Cancel' : 'Edit'}
        </button>
      )}
      {editMode && ev.type === 'investigation' && (
        <span className={styles.eventFormRow}>
          <input type="number" value={holeInput} onChange={(e) => setHoleInput(e.target.value)} aria-label="Hole id" />
          <input type="number" value={startInput} onChange={(e) => setStartInput(e.target.value)} aria-label="Start frame" />
          <input type="number" value={endInput} onChange={(e) => setEndInput(e.target.value)} aria-label="End frame" />
          <button
            type="button"
            data-testid={`save-event-${ev.id}`}
            onClick={() => {
              onEditHole(Number(holeInput));
              onEditFrames(Number(startInput) - 1, Number(endInput) - 1);
              setEditMode(false);
            }}
          >
            Save
          </button>
        </span>
      )}
    </li>
  );
}
