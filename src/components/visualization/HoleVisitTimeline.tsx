import type { HoleVisitTimelineModel, InvestigationSpan, EscapeMarkerKind } from '../../domain/visualization/holeVisitTimeline';
import {
  resolveTimelineLegend,
  type TimelineLegendKind,
  LEGEND_LABELS,
  LEGEND_ABSENT_LABELS,
} from '../../domain/visualization/timelineLegend';
import styles from '../../styles/app.module.css';

interface HoleVisitTimelineProps {
  model: HoleVisitTimelineModel;
  onSeekFrame?: (frameIndex: number) => void;
}

const ROW_HEIGHT = 18;
const Y_TITLE_X = 16;
const TICK_LABEL_X = 48;
const PLOT_LEFT = 54;
const TOP_PAD = 40;
const BOTTOM_PAD = 52;
const RIGHT_PAD = 16;
const CHART_WIDTH = 680;

const CANDIDATE_STROKE = '#c45c00';
const CANDIDATE_DASH = '6 4';

function xTicks(durationSec: number): number[] {
  if (durationSec <= 0) return [0];
  const step =
    durationSec <= 15 ? 5 : durationSec <= 30 ? 10 : durationSec <= 60 ? 15 : 30;
  const ticks: number[] = [0];
  for (let t = step; t < durationSec; t += step) ticks.push(t);
  if (ticks[ticks.length - 1] !== durationSec) ticks.push(durationSec);
  return ticks;
}

function investigationFill(status: InvestigationSpan['status']): string {
  return status === 'proposed' ? 'url(#timeline-proposed-hatch)' : '#2b2b2b';
}

function investigationStroke(status: InvestigationSpan['status'], origin: InvestigationSpan['origin']) {
  const manual = origin === 'manual';
  if (status === 'proposed') {
    return {
      stroke: manual ? '#005ea2' : '#4a4a4a',
      strokeWidth: manual ? 2 : 1,
      strokeDasharray: '4 2',
    };
  }
  return {
    stroke: manual ? '#005ea2' : '#1a1a1a',
    strokeWidth: manual ? 2.5 : 0.75,
    strokeDasharray: undefined as string | undefined,
  };
}

function CandidateEntryGlyph({
  x,
  y1,
  y2,
  circleCy,
  circleTestId,
}: {
  x: number;
  y1: number;
  y2: number;
  circleCy: number;
  circleTestId?: string;
}) {
  return (
    <>
      <line
        x1={x}
        y1={y1}
        x2={x}
        y2={y2}
        stroke={CANDIDATE_STROKE}
        strokeWidth={2}
        strokeDasharray={CANDIDATE_DASH}
      />
      <circle
        cx={x}
        cy={circleCy}
        r={4}
        fill="none"
        stroke={CANDIDATE_STROKE}
        strokeWidth={1.5}
        data-testid={circleTestId}
      />
    </>
  );
}

function LegendSample({ kind }: { kind: TimelineLegendKind }) {
  const w = 40;
  const h = 16;
  if (kind === 'confirmed_investigation') {
    return (
      <svg width={w} height={h} aria-hidden="true" className={styles.legendSampleSvg}>
        <rect x={2} y={5} width={36} height={6} fill="#2b2b2b" stroke="#1a1a1a" strokeWidth={0.75} />
      </svg>
    );
  }
  if (kind === 'proposed_investigation') {
    return (
      <svg width={w} height={h} aria-hidden="true" className={styles.legendSampleSvg}>
        <defs>
          <pattern id="legend-proposed-hatch" width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={5} stroke="#666" strokeWidth={1.2} />
          </pattern>
        </defs>
        <rect x={2} y={5} width={36} height={6} fill="url(#legend-proposed-hatch)" stroke="#4a4a4a" strokeWidth={1} strokeDasharray="3 2" />
      </svg>
    );
  }
  if (kind === 'manual_provenance') {
    return (
      <svg width={w} height={h} aria-hidden="true" className={styles.legendSampleSvg}>
        <rect x={2} y={5} width={36} height={6} fill="#2b2b2b" stroke="#005ea2" strokeWidth={2.5} />
      </svg>
    );
  }
  if (kind === 'entry_onset') {
    return (
      <svg width={w} height={h} aria-hidden="true" className={styles.legendSampleSvg}>
        <line x1={20} y1={2} x2={20} y2={14} stroke="#555" strokeWidth={1.5} strokeDasharray="3 3" />
        <rect x={17} y={1} width={6} height={4} fill="#555" />
      </svg>
    );
  }
  if (kind === 'confirmed_completion') {
    return (
      <svg width={w} height={h} aria-hidden="true" className={styles.legendSampleSvg}>
        <line x1={20} y1={2} x2={20} y2={14} stroke="#111" strokeWidth={2.5} />
        <polygon points="20,1 24,6 16,6" fill="#111" />
      </svg>
    );
  }
  if (kind === 'candidate_entry') {
    return (
      <svg
        width={w}
        height={h}
        aria-hidden="true"
        className={styles.legendSampleSvg}
        data-testid="hole-timeline-legend-candidate-glyph"
      >
        <CandidateEntryGlyph x={20} y1={2} y2={14} circleCy={8} />
      </svg>
    );
  }
  if (kind === 'pre_trial_region') {
    return (
      <svg width={w} height={h} aria-hidden="true" className={styles.legendSampleSvg}>
        <rect x={2} y={4} width={16} height={8} fill="rgba(120,120,120,0.15)" stroke="#888" strokeWidth={0.75} />
        <rect x={22} y={5} width={16} height={6} fill="#2b2b2b" />
      </svg>
    );
  }
  return (
    <svg width={w} height={h} aria-hidden="true" className={styles.legendSampleSvg}>
      <rect x={2} y={4} width={16} height={8} fill="#2b2b2b" />
      <rect x={22} y={4} width={16} height={8} fill="rgba(120,120,120,0.25)" stroke="#888" strokeWidth={0.75} />
    </svg>
  );
}

export function HoleVisitTimeline({ model, onSeekFrame }: HoleVisitTimelineProps) {
  const width = CHART_WIDTH;
  const plotHeight = model.holeDisplays.length * ROW_HEIGHT;
  const height = TOP_PAD + plotHeight + BOTTOM_PAD;
  const plotWidth = width - PLOT_LEFT - RIGHT_PAD;
  const durationSec = Math.max(0.001, model.trialDurationSec);
  const ticks = xTicks(durationSec);
  const legend = resolveTimelineLegend(model, model.investigations);

  const xForSec = (sec: number) => PLOT_LEFT + (sec / durationSec) * plotWidth;
  const censorX = xForSec(model.censorSec);
  const postCensorWidth = Math.max(0, width - RIGHT_PAD - censorX);

  const renderEscapeMarker = (
    marker: { kind: EscapeMarkerKind; sec: number; frameIndex: number; label: string },
    i: number,
  ) => {
    if (marker.kind === 'censor_boundary') return null;

    const x = xForSec(marker.sec);
    const yTop = TOP_PAD;
    const yBottom = TOP_PAD + plotHeight;
    const isCompletion = marker.kind === 'completion';
    const isCandidate = marker.kind === 'candidate_entry';
    const isEntryOnset = marker.kind === 'entry_onset';

    const stroke = isCompletion ? '#111111' : isCandidate ? CANDIDATE_STROKE : '#555555';
    const dash = isCompletion ? undefined : isCandidate ? CANDIDATE_DASH : '4 3';
    const widthPx = isCompletion ? 2.5 : isCandidate ? 2 : 1.5;

    return (
      <g
        key={`${marker.kind}-${i}`}
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
      >
        {isCandidate ? (
          <CandidateEntryGlyph
            x={x}
            y1={yTop}
            y2={yBottom}
            circleCy={yTop + plotHeight / 2}
            circleTestId="hole-timeline-candidate-endpoint"
          />
        ) : (
          <line
            x1={x}
            y1={yTop}
            x2={x}
            y2={yBottom}
            stroke={stroke}
            strokeWidth={widthPx}
            strokeDasharray={dash}
          />
        )}
        {isCompletion && (
          <polygon
            points={`${x},${yTop - 1} ${x + 6},${yTop + 7} ${x - 6},${yTop + 7}`}
            fill={stroke}
            data-testid="hole-timeline-completion-endpoint"
          />
        )}
        {isEntryOnset && (
          <rect x={x - 3} y={yTop} width={6} height={5} fill={stroke} />
        )}
        <title>{`${marker.label} — ${marker.sec.toFixed(2)} s`}</title>
      </g>
    );
  };

  return (
    <figure className={styles.vizFigure} data-testid="hole-visit-timeline">
      <figcaption>Hole-visit timeline</figcaption>
      <p className={styles.vizDescription} data-testid="hole-timeline-description">
        Horizontal bars are investigation intervals. Vertical markers show entry onset, confirmed
        body-entry completion, or candidate entry evidence — not the protocol target designation.
      </p>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Hole visit timeline"
        className={styles.vizSvg}
        data-testid="hole-timeline-svg"
      >
        <defs>
          <pattern id="timeline-proposed-hatch" width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={5} stroke="#666666" strokeWidth={1.2} />
          </pattern>
        </defs>

        {model.preTrialEndSec > 0.001 && (
          <rect
            x={PLOT_LEFT}
            y={TOP_PAD}
            width={Math.max(0, xForSec(model.preTrialEndSec) - PLOT_LEFT)}
            height={plotHeight}
            fill="rgba(120, 120, 120, 0.12)"
            data-testid="hole-timeline-pretrial-region"
          />
        )}

        {postCensorWidth > 0.5 && (
          <rect
            x={censorX}
            y={TOP_PAD}
            width={postCensorWidth}
            height={plotHeight}
            fill="rgba(120, 120, 120, 0.22)"
            data-testid="hole-timeline-censor-region"
          />
        )}

        <line
          x1={censorX}
          y1={TOP_PAD}
          x2={censorX}
          y2={TOP_PAD + plotHeight}
          stroke="#666"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          data-testid="hole-timeline-censor-line"
        />
        <text
          x={Math.min(censorX + 4, width - RIGHT_PAD - 80)}
          y={TOP_PAD - 6}
          className={styles.timelineRegionLabel}
          data-testid="hole-timeline-censor-label"
        >
          Censor / trial end
        </text>

        {model.holeDisplays.map((holeDisplay, row) => {
          const y = TOP_PAD + row * ROW_HEIGHT;
          return (
            <g key={holeDisplay}>
              <text
                x={TICK_LABEL_X}
                y={y + ROW_HEIGHT * 0.68}
                textAnchor="end"
                className={styles.timelineAxisTick}
                data-testid="hole-timeline-y-tick-label"
              >
                {holeDisplay}
              </text>
              <line
                x1={PLOT_LEFT}
                y1={y + ROW_HEIGHT}
                x2={width - RIGHT_PAD}
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
          const stroke = investigationStroke(inv.status, inv.origin);
          return (
            <rect
              key={inv.id}
              x={x}
              y={y}
              width={w}
              height={ROW_HEIGHT - 6}
              fill={investigationFill(inv.status)}
              stroke={stroke.stroke}
              strokeWidth={stroke.strokeWidth}
              strokeDasharray={stroke.strokeDasharray}
              data-testid="hole-timeline-investigation"
              data-status={inv.status}
              data-origin={inv.origin}
              data-revisit={inv.isRevisit ? 'true' : 'false'}
              role="button"
              tabIndex={0}
              aria-label={`Hole ${inv.holeDisplay} ${inv.status} investigation ${inv.startSec.toFixed(2)}–${inv.endSec.toFixed(2)} s${inv.origin === 'manual' ? ' (manual provenance)' : ''}`}
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

        {model.escapeMarkers.map(renderEscapeMarker)}

        {ticks.map((t) => (
          <g key={`xtick-${t}`}>
            <line
              x1={xForSec(t)}
              y1={TOP_PAD + plotHeight}
              x2={xForSec(t)}
              y2={TOP_PAD + plotHeight + 4}
              stroke="#666"
              strokeWidth={1}
            />
            <text
              x={xForSec(t)}
              y={height - 26}
              textAnchor="middle"
              className={styles.timelineAxisTick}
            >
              {t.toFixed(t % 1 === 0 ? 0 : 1)}
            </text>
          </g>
        ))}

        <text
          x={PLOT_LEFT + plotWidth / 2}
          y={height - 6}
          textAnchor="middle"
          className={styles.timelineAxisTitle}
          data-testid="hole-timeline-x-axis-label"
        >
          Elapsed time from trial start (s)
        </text>
        <text
          x={Y_TITLE_X}
          y={TOP_PAD + plotHeight / 2}
          textAnchor="middle"
          transform={`rotate(-90 ${Y_TITLE_X} ${TOP_PAD + plotHeight / 2})`}
          className={styles.timelineAxisTitle}
          data-testid="hole-timeline-y-axis-label"
        >
          Hole number (1–20)
        </text>
      </svg>

      <ul className={styles.vizLegend} data-testid="hole-timeline-legend">
        {legend.present.map((kind) => (
          <li key={kind} data-testid={`hole-timeline-legend-${kind}`}>
            <LegendSample kind={kind} /> {LEGEND_LABELS[kind]}
          </li>
        ))}
      </ul>
      {legend.absent.length > 0 && (
        <p className={styles.legendAbsentNote} data-testid="hole-timeline-legend-absent">
          Absent in this trial: {legend.absent.map((k) => LEGEND_ABSENT_LABELS[k]).join('; ')}
        </p>
      )}
    </figure>
  );
}
