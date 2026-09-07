import type { HoleVisitTimelineModel } from '../../domain/visualization/holeVisitTimeline';
import styles from '../../styles/app.module.css';

interface HoleVisitTimelineProps {
  model: HoleVisitTimelineModel;
  onSeekFrame?: (frameIndex: number) => void;
}

const ROW_HEIGHT = 18;
const LEFT_PAD = 44;
const TOP_PAD = 28;
const BOTTOM_PAD = 32;

function statusClass(status: string, origin: string): string {
  if (status === 'proposed') return styles.timelineSpanProposed;
  if (status === 'confirmed') return styles.timelineSpanConfirmed;
  if (origin === 'manual') return styles.timelineSpanManual;
  return styles.timelineSpanAuto;
}

export function HoleVisitTimeline({ model, onSeekFrame }: HoleVisitTimelineProps) {
  const width = 640;
  const height = TOP_PAD + model.holeDisplays.length * ROW_HEIGHT + BOTTOM_PAD;
  const plotWidth = width - LEFT_PAD - 12;
  const durationSec = Math.max(0.001, model.trialDurationSec);

  const xForSec = (sec: number) => LEFT_PAD + (sec / durationSec) * plotWidth;

  return (
    <figure className={styles.vizFigure} data-testid="hole-visit-timeline">
      <figcaption>Hole-visit timeline (trial-relative seconds)</figcaption>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Hole visit timeline"
        className={styles.vizSvg}
      >
        {model.preTrialEndSec > 0 && (
          <rect
            x={LEFT_PAD}
            y={TOP_PAD}
            width={xForSec(model.preTrialEndSec) - LEFT_PAD}
            height={model.holeDisplays.length * ROW_HEIGHT}
            className={styles.timelinePreTrialShade}
          />
        )}
        <rect
          x={xForSec(model.censorSec)}
          y={TOP_PAD}
          width={width - xForSec(model.censorSec)}
          height={model.holeDisplays.length * ROW_HEIGHT}
          className={styles.timelineCensorShade}
        />

        {model.holeDisplays.map((holeDisplay, row) => {
          const y = TOP_PAD + row * ROW_HEIGHT;
          return (
            <g key={holeDisplay}>
              <text x={8} y={y + ROW_HEIGHT * 0.65} className={styles.timelineAxisLabel}>
                {holeDisplay}
              </text>
              <line
                x1={LEFT_PAD}
                y1={y + ROW_HEIGHT}
                x2={width - 8}
                y2={y + ROW_HEIGHT}
                className={styles.timelineGridLine}
              />
            </g>
          );
        })}

        {model.investigations.map((inv) => {
          const row = inv.holeDisplay - 1;
          const y = TOP_PAD + row * ROW_HEIGHT + 3;
          const x = xForSec(Math.max(0, inv.startSec));
          const w = Math.max(2, xForSec(inv.endSec) - x);
          return (
            <rect
              key={inv.id}
              x={x}
              y={y}
              width={w}
              height={ROW_HEIGHT - 6}
              className={statusClass(inv.status, inv.origin)}
              data-testid="hole-timeline-investigation"
              data-status={inv.status}
              data-revisit={inv.isRevisit ? 'true' : 'false'}
              role="button"
              tabIndex={0}
              aria-label={`Hole ${inv.holeDisplay} investigation ${inv.startSec.toFixed(2)}–${inv.endSec.toFixed(2)} s (${inv.status})`}
              onClick={() => onSeekFrame?.(inv.startFrameIndex)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSeekFrame?.(inv.startFrameIndex);
                }
              }}
            />
          );
        })}

        {model.escapeMarkers.map((marker, i) => {
          const x = xForSec(marker.sec);
          const markerClass =
            marker.kind === 'completion'
              ? styles.timelineEscapeCompletion
              : marker.kind === 'candidate_entry'
                ? styles.timelineEscapeCandidate
                : marker.kind === 'censor_boundary'
                  ? styles.timelineCensorLine
                  : styles.timelineEscapeEntry;
          return (
            <g key={`${marker.kind}-${i}`}>
              <line
                x1={x}
                y1={TOP_PAD}
                x2={x}
                y2={TOP_PAD + model.holeDisplays.length * ROW_HEIGHT}
                className={markerClass}
                data-testid={`hole-timeline-${marker.kind}`}
                role="button"
                tabIndex={0}
                aria-label={`${marker.label} at ${marker.sec.toFixed(2)} s`}
                onClick={() => onSeekFrame?.(marker.frameIndex)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSeekFrame?.(marker.frameIndex);
                  }
                }}
              />
              <title>{`${marker.label} — ${marker.sec.toFixed(2)} s`}</title>
            </g>
          );
        })}

        <text x={LEFT_PAD} y={height - 8} className={styles.timelineAxisLabel}>
          0 s
        </text>
        <text x={width - 48} y={height - 8} className={styles.timelineAxisLabel}>
          {durationSec.toFixed(1)} s
        </text>
      </svg>
      <ul className={styles.vizLegend}>
        <li><span className={styles.legendSwatchConfirmed} /> Confirmed investigation</li>
        <li><span className={styles.legendSwatchProposed} /> Proposed investigation</li>
        <li><span className={styles.legendSwatchManual} /> Manual event</li>
        <li><span className={styles.legendSwatchCompletion} /> Confirmed completion</li>
        <li><span className={styles.legendSwatchCandidate} /> Candidate entry</li>
      </ul>
    </figure>
  );
}
