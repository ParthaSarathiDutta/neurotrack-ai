import { useEffect, useState } from 'react';
import type { TrialRecord } from '../domain/types';
import { useSessionStore } from '../store/sessionStore';
import styles from '../styles/app.module.css';

interface CalibrationPanelProps {
  trial: TrialRecord;
  allTrials: TrialRecord[];
  onManualClick?: (x: number, y: number) => void;
  registerManualHandler?: (handler: ((x: number, y: number) => void) | null) => void;
}

type ManualStep = 'idle' | 'center' | 'radius' | 'anchor';

export function CalibrationPanel({
  trial,
  allTrials,
  registerManualHandler,
}: CalibrationPanelProps) {
  const runAutoDetect = useSessionStore((s) => s.runAutoDetect);
  const confirmGeometry = useSessionStore((s) => s.confirmGeometry);
  const setTargetHole = useSessionStore((s) => s.setTargetHole);
  const confirmTargetHole = useSessionStore((s) => s.confirmTargetHole);
  const setDiameterCm = useSessionStore((s) => s.setDiameterCm);
  const nudgeHole = useSessionStore((s) => s.nudgeHole);
  const setManualGeometry = useSessionStore((s) => s.setManualGeometry);
  const applyTemplate = useSessionStore((s) => s.applyTemplate);
  const templateWarning = useSessionStore((s) => s.templateWarning);
  const calibrationBusy = useSessionStore((s) => s.calibrationBusy);

  const [selectedHoleId] = useState<number | null>(null);
  const [manualStep, setManualStep] = useState<ManualStep>('idle');
  const [diameterInput, setDiameterInput] = useState(
    trial.geometry.diameterCm?.toString() ?? '91',
  );

  useEffect(() => {
    setManualStep('idle');
    setDiameterInput(trial.geometry.diameterCm?.toString() ?? '91');
    registerManualHandler?.(null);
  }, [trial.id, trial.geometry.diameterCm, registerManualHandler]);

  const geo = trial.geometry;
  const templateSources = allTrials.filter(
    (t) => t.id !== trial.id && t.geometry.confirmedAt && t.geometry.holes.length === 20,
  );

  const startManual = () => {
    setManualStep('center');
    let step: ManualStep = 'center';
    let center: { x: number; y: number } | null = null;
    registerManualHandler?.((x, y) => {
      if (step === 'center') {
        center = { x, y };
        step = 'radius';
        setManualStep('radius');
      } else if (step === 'radius' && center) {
        const radius = Math.hypot(x - center.x, y - center.y);
        setManualGeometry(trial.id, center, radius, { x, y });
        step = 'idle';
        setManualStep('idle');
        registerManualHandler?.(null);
      }
    });
  };

  const handleNudge = (dx: number, dy: number) => {
    if (selectedHoleId == null) return;
    const hole = geo.holes.find((h) => h.id === selectedHoleId);
    if (!hole) return;
    nudgeHole(trial.id, selectedHoleId, hole.x + dx, hole.y + dy);
  };

  const detectedCount = geo.holes.filter((h) => h.source === 'detected').length;
  const modelCount = geo.holes.filter((h) => h.source === 'model').length;
  const manualCount = geo.holes.filter((h) => h.source === 'manual').length;
  const confidence = geo.detection?.confidence;
  const needsReview =
    geo.source === 'auto' &&
    (confidence === 'low' || confidence === 'failed') &&
    manualCount === 0;
  const canConfirmGeometry = !needsReview;

  return (
    <section
      className={styles.panel}
      aria-labelledby="calibration-heading"
      data-testid="calibration-panel"
      data-trial-label={trial.label}
    >
      <h2 id="calibration-heading">Maze calibration</h2>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={calibrationBusy || !trial.videoCached}
          onClick={() => void runAutoDetect(trial.id)}
          data-testid="auto-detect-btn"
        >
          {calibrationBusy ? 'Detecting…' : 'Auto-detect maze'}
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={calibrationBusy}
          onClick={startManual}
          data-testid="manual-calibration-btn"
        >
          Manual calibration
        </button>
      </div>

      {manualStep !== 'idle' && (
        <p className={styles.hint} role="status">
          {manualStep === 'center' && 'Click the platform center on the video.'}
          {manualStep === 'radius' && 'Click the platform edge to set radius.'}
        </p>
      )}

      {templateSources.length > 0 && (
        <div className={styles.templateSection}>
          <label htmlFor="template-select">Apply template from</label>
          <select
            id="template-select"
            className={styles.select}
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) void applyTemplate(trial.id, e.target.value);
              e.target.value = '';
            }}
            data-testid="template-select"
          >
            <option value="">— select trial —</option>
            {templateSources.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {templateWarning && (
        <div className={styles.warningBox} role="alert" data-testid="template-discrepancy-warning">
          {templateWarning}
        </div>
      )}

      {geo.holes.length > 0 && (
        <>
          <p data-testid="hole-count-summary">
            {geo.holes.length} holes: {detectedCount} detected, {modelCount} modeled
            {manualCount > 0 ? `, ${manualCount} manual` : ''}
          </p>

          {confidence && confidence !== 'high' && (
            <div
              className={styles.warningBox}
              role="alert"
              data-testid="calibration-confidence-warning"
            >
              {confidence === 'low'
                ? 'Low-confidence automatic calibration — review hole markers on the video and nudge any misaligned holes before confirming.'
                : 'Automatic calibration failed quality checks — use manual calibration or adjust holes before confirming.'}
              {geo.detection?.confidenceReasons?.length ? (
                <ul className={styles.reasonList}>
                  {geo.detection.confidenceReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}

          {confidence === 'high' && geo.source === 'auto' && (
            <p className={styles.hint} data-testid="calibration-confidence-high">
              High-confidence calibration (max residual{' '}
              {geo.detection?.ringFitResidualPx?.toFixed(1) ?? '—'} px). Review overlay before confirming.
            </p>
          )}

          <div className={styles.actions}>
            <label htmlFor="target-hole">Target hole</label>
            <select
              id="target-hole"
              className={styles.select}
              value={geo.targetHoleId !== null ? String(geo.targetHoleId) : geo.proposedTargetHoleId !== null ? String(geo.proposedTargetHoleId) : ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v !== '') setTargetHole(trial.id, Number(v));
              }}
              data-testid="target-hole-select"
            >
              <option value="">— select —</option>
              {geo.holes.map((h) => (
                <option key={h.id} value={h.id}>
                  Hole {h.id + 1}
                  {h.id === geo.proposedTargetHoleId && !geo.targetHoleConfirmedAt
                    ? ' (proposed)'
                    : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={styles.buttonPrimary}
              onClick={() => confirmTargetHole(trial.id)}
              data-testid="confirm-target-btn"
            >
              Confirm target hole
            </button>
            {geo.targetHoleConfirmedAt && (
              <span className={styles.confirmedMarker} data-testid="target-confirmed">
                Target confirmed
              </span>
            )}
          </div>

          <div className={styles.labelField}>
            <label htmlFor="diameter-cm">Platform diameter (cm)</label>
            <input
              id="diameter-cm"
              type="number"
              min={1}
              step={0.1}
              value={diameterInput}
              onChange={(e) => setDiameterInput(e.target.value)}
              onBlur={() => {
                const v = parseFloat(diameterInput);
                if (v > 0) setDiameterCm(trial.id, v);
              }}
              data-testid="diameter-input"
            />
            {geo.pxPerCm != null && (
              <span className={styles.mono} data-testid="px-per-cm">
                {geo.pxPerCm.toFixed(2)} px/cm
              </span>
            )}
          </div>

          {selectedHoleId != null && (
            <div className={styles.actions}>
              <span>Nudge hole {selectedHoleId + 1}:</span>
              <button type="button" className={styles.button} onClick={() => handleNudge(-2, 0)} aria-label="Nudge left">←</button>
              <button type="button" className={styles.button} onClick={() => handleNudge(2, 0)} aria-label="Nudge right">→</button>
              <button type="button" className={styles.button} onClick={() => handleNudge(0, -2)} aria-label="Nudge up">↑</button>
              <button type="button" className={styles.button} onClick={() => handleNudge(0, 2)} aria-label="Nudge down">↓</button>
            </div>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.buttonPrimary}
              disabled={!canConfirmGeometry}
              onClick={() => confirmGeometry(trial.id)}
              data-testid="confirm-geometry-btn"
            >
              Confirm geometry
            </button>
            {!canConfirmGeometry && (
              <span className={styles.hint} data-testid="confirm-geometry-blocked">
                Adjust at least one hole manually before confirming low-confidence calibration.
              </span>
            )}
            {geo.confirmedAt && (
              <span className={styles.confirmedMarker} data-testid="geometry-confirmed">
                Geometry confirmed
              </span>
            )}
          </div>

          <details className={styles.details} data-testid="calibration-technical-details">
            <summary>Technical details</summary>
            <table className={styles.metaTable}>
              <tbody>
                <tr>
                  <th scope="row">Trial</th>
                  <td data-testid="calibration-trial-label">{trial.label}</td>
                </tr>
                <tr>
                  <th scope="row">Source</th>
                  <td>{geo.source ?? '—'}</td>
                </tr>
                <tr>
                  <th scope="row">Confidence</th>
                  <td data-testid="calibration-confidence">{geo.detection?.confidence ?? '—'}</td>
                </tr>
                <tr>
                  <th scope="row">Max slot residual</th>
                  <td data-testid="calibration-max-residual">
                    {geo.detection?.ringFitResidualPx?.toFixed(2) ?? '—'} px
                  </td>
                </tr>
                <tr>
                  <th scope="row">Median slot residual</th>
                  <td data-testid="calibration-median-residual">
                    {geo.detection?.medianSlotResidualPx?.toFixed(2) ?? '—'} px
                  </td>
                </tr>
                <tr>
                  <th scope="row">Circle fit residual</th>
                  <td data-testid="calibration-circle-residual">
                    {geo.detection?.circleFitResidualPx?.toFixed(2) ?? '—'} px
                  </td>
                </tr>
                <tr>
                  <th scope="row">Hole candidates</th>
                  <td>{geo.detection?.holeCandidateCount ?? '—'}</td>
                </tr>
                <tr>
                  <th scope="row">Platform edge samples</th>
                  <td>{geo.detection?.platformEdgeSampleCount ?? '—'}</td>
                </tr>
                {geo.templateSourceTrialId && (
                  <tr>
                    <th scope="row">Template source</th>
                    <td>{allTrials.find((t) => t.id === geo.templateSourceTrialId)?.label ?? geo.templateSourceTrialId}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
