import type { HoleVisitTimelineModel, InvestigationSpan, EscapeMarkerKind } from '../../domain/visualization/holeVisitTimeline';
import styles from '../../styles/app.module.css';

interface HoleVisitTimelineProps {
  model: HoleVisitTimelineModel;
  onSeekFrame?: (frameIndex: number) => void;
}

const ROW_HEIGHT = 18;
const LEFT_PAD = 52;
const TOP_PAD = 36;
const BOTTOM_PAD = 44;
const RIGHT_PAD = 12;
const CHART_WIDTH = 640;

function xTicks(durationSec: number): number[] {
  if (durationSec <= 0) return [0];
  const step =
    durationSec <= 15 ? 5 : durationSec <= 30 ? 10 : durationSec <= 60 ? 15 : 30;
  const ticks: number[] = [0];
  for (let t = step; t < durationSec; t += step) ticks.push(t);
  ticks.push(durationSec);
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

function LegendSample({ kind }: { kind: 'confirmed' | 'proposed' | 'manual' | 'completion' | 'candidate' | 'censor' }) {
  const w = 36;
  const h = 14;
  if (kind === 'confirmed') {
    return (
      <svg width={w} height={h} aria-hidden="true" className={styles.legendSampleSvg}>
        <rect x={2} y={4} width={32} height={6} fill="#2b2b2b" stroke="#1a1a1a" strokeWidth={0.75} />
      </svg>
    );
  }
  if (kind === 'proposed') {
    return (
      <svg width={w} height={h} aria-hidden="true" className={styles.legendSampleSvg}>
        <defs>
          <pattern id="legend-proposed-hatch" width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={4} stroke="#666" strokeWidth={1} />
          </pattern>
        </defs>
        <rect x={2} y={4} width={32} height={6} fill="url(#legend-proposed-hatch)" stroke="#4a4a4a" strokeWidth={1} strokeDasharray="3 2" />
      </svg>
    );
  }
  if (kind === 'manual') {
    return (
      <svg width={w} height={h} aria-hidden="true" className={styles.legendSampleSvg}>
        <rect x={2} y={4} width={32} height={6} fill="#2b2b2b" stroke="#005ea2" strokeWidth={2.5} />
      </svg>
    );
  }
  if (kind === 'completion') {
    return (
      <svg width={w} height={h} aria-hidden="true" className={styles.legendSampleSvg}>
        <line x1={18} y1={2} x2={18} y2={12} stroke="#111" strokeWidth={2.5} />
        <polygon points="18,1 21,5 15,5" fill="#111" />
      </svg>
    );
  }
  if (kind === 'candidate') {
    return (
      <svg width={w} height={h} aria-hidden="true" className={styles.legendSampleSvg}>
        <line x1={18} y1={2} x2={18} y2={12} stroke="#7a4a00" strokeWidth={2} strokeDasharray="4 3" />
      </svg>
    );
  }
  return (
    <svg width={w} height={h} aria-hidden="true" className={styles.legendSampleSvg}>
      <rect x={4} y={3} width={28} height={8} fill="rgba(120,120,120,0.25)" stroke="#888" strokeWidth={1} />
    </svg>
  );
}

export function HoleVisitTimeline({ model, onSeekFrame }: HoleVisitTimelineProps) {
  const width = CHART_WIDTH;
  const plotHeight = model.holeDisplays.length * ROW_HEIGHT;
  const height = TOP_PAD + plotHeight + BOTTOM_PAD;
  const plotWidth = width - LEFT_PAD - RIGHT_PAD;
  const durationSec = Math.max(0.001, model.trialDurationSec);
  const ticks = xTicks(durationSec);

  const xForSec = (sec: number) => LEFT_PAD + (sec / durationSec) * plotWidth;

  const renderEscapeMarker = (marker: { kind: EscapeMarkerKind; sec: number; frameIndex: number; label: string }, i: number) => {
    const x = xForSec(marker.sec);
    const yTop = TOP_PAD;
    const yBottom = TOP_PAD + plotHeight;

    if (marker.kind === 'censor_boundary') {
      return (
        <g key={`${marker.kind}-${i}`} data-testid="hole-timeline-censor_boundary">
          <title>{`${marker.label} — ${marker.sec.toFixed(2)} s`}</title>
        </g>
      );
    }

    const isCompletion = marker.kind === 'completion';
    const isCandidate = marker.kind === 'candidate_entry';
    const stroke = isCompletion ? '#111111' : isCandidate ? '#7a4a00' : '#444444';
    const dash = isCompletion ? undefined : '5 4';

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
        <line
          x1={x}
          y1={yTop}
          x2={x}
          y2={yBottom}
          stroke={stroke}
          strokeWidth={isCompletion ? 2.5 : 2}
          strokeDasharray={dash}
        />
        {isCompletion && (
          <polygon
            points={`${x},${yTop - 2} ${x + 5},${yTop + 6} ${x - 5},${yTop + 6}`}
            fill={stroke}
            data-testid="hole-timeline-completion-endpoint"
          />
        )}
        <title>{`${marker.label} — ${marker.sec.toFixed(2)} s`}</title>
      </g>
    );
  };

  return (
    <figure className={styles.vizFigure} data-testid="hole-visit-timeline">
      <figcaption>Hole-visit timeline</figcaption>
      <p className={styles.vizDescription} data-testid="hole-timeline-description">
        Horizontal bars show hole investigation intervals (confirmed vs proposed status). Vertical markers
        show hole entry onset, confirmed body-entry completion, or candidate entry evidence — not the
        protocol target designation. Shaded regions mark pre-trial and post-censor boundaries.
      </p>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Hole visit timeline"
        className={styles.vizSvg}
      >
        <defs>
          <pattern id="timeline-proposed-hatch" width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={5} stroke="#666666" strokeWidth={1.2} />
          </pattern>
        </defs>

        {model.preTrialEndSec > 0 && (
          <rect
            x={LEFT_PAD}
            y={TOP_PAD}
            width={Math.max(0, xForSec(model.preTrialEndSec) - LEFT_PAD)}
            height={plotHeight}
            fill="rgba(120, 120, 120, 0.12)"
          />
        )}
        <rect
          x={xForSec(model.censorSec)}
          y={TOP_PAD}
          width={Math.max(0, width - RIGHT_PAD - xForSec(model.censorSec))}
          height={plotHeight}
          fill="rgba(120, 120, 120, 0.22)"
          data-testid="hole-timeline-censor-region"
        />

        {model.holeDisplays.map((holeDisplay, row) => {
          const y = TOP_PAD + row * ROW_HEIGHT;
          return (
            <g key={holeDisplay}>
              <text x={6} y={y + ROW_HEIGHT * 0.68} className={styles.timelineAxisTick}>
                {holeDisplay}
              </text>
              <line
                x1={LEFT_PAD}
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
              y={height - 18}
              textAnchor="middle"
              className={styles.timelineAxisTick}
            >
              {t.toFixed(t % 1 === 0 ? 0 : 1)}
            </text>
          </g>
        ))}

        <text
          x={LEFT_PAD + plotWidth / 2}
          y={height - 4}
          textAnchor="middle"
          className={styles.timelineAxisTitle}
          data-testid="hole-timeline-x-axis-label"
        >
          Elapsed time from trial start (s)
        </text>
        <text
          x={14}
          y={TOP_PAD + plotHeight / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${TOP_PAD + plotHeight / 2})`}
          className={styles.timelineAxisTitle}
          data-testid="hole-timeline-y-axis-label"
        >
          Hole number (1–20)
        </text>
      </svg>

      <ul className={styles.vizLegend} data-testid="hole-timeline-legend">
        <li><LegendSample kind="confirmed" /> Confirmed investigation (bar)</li>
        <li><LegendSample kind="proposed" /> Proposed investigation (hatched bar)</li>
        <li><LegendSample kind="manual" /> Manual provenance (outline)</li>
        <li><LegendSample kind="completion" /> Confirmed body-entry completion</li>
        <li><LegendSample kind="candidate" /> Candidate entry (dashed marker)</li>
        <li><LegendSample kind="censor" /> Censor / post-trial region</li>
      </ul>
    </figure>
  );
}
