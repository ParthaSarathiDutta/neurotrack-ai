import { useMemo } from 'react';
import type { TrialRecord } from '../domain/types';
import { resolveMeasurementObservations } from '../domain/trajectory/measurementObservations';
import { effectiveTrialStartUs, censorBoundaryTimeUs } from '../domain/events/holeProximity';
import { buildHoleVisitTimelineModel } from '../domain/visualization/holeVisitTimeline';
import { HoleVisitTimeline } from './visualization/HoleVisitTimeline';
import { OccupancyHeatmap } from './visualization/OccupancyHeatmap';
import styles from '../styles/app.module.css';

interface TrialVisualizationsPanelProps {
  trial: TrialRecord;
  onSeekToFrame?: (frameIndex: number) => void;
  showTrajectoryHint?: boolean;
}

export function TrialVisualizationsPanel({
  trial,
  onSeekToFrame,
  showTrajectoryHint = false,
}: TrialVisualizationsPanelProps) {
  const basis = trial.measurementBasis ?? 'corrected';
  const resolved = useMemo(
    () => resolveMeasurementObservations(trial.track, basis),
    [trial.track, basis],
  );

  const trialStartUs = effectiveTrialStartUs(trial.trialWindow);
  const censorUs = censorBoundaryTimeUs(trial.trialWindow, trial.timestampIndex);

  const timelineModel = useMemo(() => {
    if (trialStartUs == null || censorUs == null) return null;
    return buildHoleVisitTimelineModel(
      trial.events?.events ?? [],
      trialStartUs,
      censorUs,
      trial.trialWindow.startTimeUs,
    );
  }, [trial.events?.events, trial.trialWindow, trialStartUs, censorUs]);

  if (resolved.unavailable || trialStartUs == null || censorUs == null) {
    return (
      <section className={styles.panel} data-testid="trial-visualizations-panel">
        <h3>Visualizations</h3>
        <p className={styles.hint} data-testid="viz-unavailable">
          {resolved.unavailableReason ?? 'Trial window or tracking data unavailable.'}
        </p>
      </section>
    );
  }

  return (
    <section className={styles.panel} data-testid="trial-visualizations-panel">
      <h3>Visualizations</h3>
      <p className={styles.hint}>
        Measurement basis: <strong>{basis}</strong>. Charts use container timestamps and exclude unsupported tracking gaps.
      </p>
      {showTrajectoryHint && (
        <p className={styles.hint}>
          Trajectory path is drawn on the review player when &quot;Show trajectory&quot; is enabled.
        </p>
      )}

      {timelineModel && (
        <HoleVisitTimeline model={timelineModel} onSeekFrame={onSeekToFrame} />
      )}

      <OccupancyHeatmap
        observations={resolved.observations}
        geometry={trial.geometry}
        trialStartUs={trialStartUs}
        censorUs={censorUs}
      />
    </section>
  );
}
