import type { Geometry } from '../../domain/types';
import {
  buildOccupancyGrid,
  occupancyCellColor,
  occupancyDisplayIntensity,
  occupancyHoleLabelPosition,
  summarizeOccupancyAccounting,
  videoToOccupancySvg,
} from '../../domain/visualization/occupancyGrid';
import { confirmedTargetHoleId } from '../../domain/events/holeProximity';
import type { Observation } from '../../domain/types';
import styles from '../../styles/app.module.css';

interface OccupancyHeatmapProps {
  observations: Observation[];
  geometry: Geometry;
  trialStartUs: number;
  censorUs: number;
}

const SVG_SIZE = 360;
const MARGIN = 34;
const INNER = SVG_SIZE - MARGIN * 2;
const LEGEND_WIDTH = 220;

function mapToInner(
  x: number,
  y: number,
  center: { x: number; y: number },
  radius: number,
): { cx: number; cy: number } {
  const pt = videoToOccupancySvg(x, y, center, radius, INNER);
  return { cx: pt.cx + MARGIN, cy: pt.cy + MARGIN };
}

export function OccupancyHeatmap({
  observations,
  geometry,
  trialStartUs,
  censorUs,
}: OccupancyHeatmapProps) {
  const model = buildOccupancyGrid(observations, geometry, trialStartUs, censorUs);
  const accounting = summarizeOccupancyAccounting(model);
  const center = model.platformCenter;
  const radius = model.platformRadiusPx;
  const size = model.gridSize;
  const targetId = confirmedTargetHoleId(geometry);

  if (!center || !radius || model.totalWeightUs <= 0) {
    return (
      <figure className={styles.vizFigure} data-testid="occupancy-heatmap">
        <figcaption>Occupancy heatmap</figcaption>
        <p className={styles.hint}>Occupancy unavailable — platform geometry or in-trial observations missing.</p>
      </figure>
    );
  }

  const minX = center.x - radius;
  const minY = center.y - radius;
  const span = radius * 2;
  const cellPx = INNER / size;
  const maxBinSec = model.maxWeightUs / 1_000_000;
  const platformCx = SVG_SIZE / 2;
  const platformCy = SVG_SIZE / 2;
  const platformR = INNER / 2 - 2;

  return (
    <figure className={styles.vizFigure} data-testid="occupancy-heatmap">
      <figcaption>Time-weighted occupancy on platform</figcaption>
      <p className={styles.vizDescription} data-testid="occupancy-description">
        Each square is shaded by how long the mouse spent there. Darker squares indicate more
        accumulated time. This map does not independently identify the protocol target, escape
        direction, or hole preference.
      </p>

      <div className={styles.occupancyLayout}>
        <svg
          width="100%"
          height={SVG_SIZE}
          viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Occupancy heatmap on platform"
          className={styles.vizSvg}
          data-testid="occupancy-svg"
        >
          <circle
            cx={platformCx}
            cy={platformCy}
            r={platformR}
            className={styles.occupancyPlatformOutline}
          />
          {Array.from({ length: size * size }, (_, idx) => {
            const row = Math.floor(idx / size);
            const col = idx % size;
            const weight = model.weights[idx] ?? 0;
            if (weight <= 0) return null;
            const videoX = minX + ((col + 0.5) / size) * span;
            const videoY = minY + ((row + 0.5) / size) * span;
            if (Math.hypot(videoX - center.x, videoY - center.y) > radius) return null;
            const intensity = occupancyDisplayIntensity(weight, model.maxWeightUs);
            const binSec = weight / 1_000_000;
            return (
              <rect
                key={idx}
                x={MARGIN + col * cellPx}
                y={MARGIN + row * cellPx}
                width={cellPx}
                height={cellPx}
                fill={occupancyCellColor(intensity)}
                stroke="rgba(255,255,255,0.35)"
                strokeWidth={0.35}
                data-testid="occupancy-cell"
                data-weight-sec={binSec.toFixed(3)}
              >
                <title>{`${binSec.toFixed(2)} s in this bin`}</title>
              </rect>
            );
          })}

          {geometry.holes.map((hole) => {
            const p = mapToInner(hole.x, hole.y, center, radius);
            const label = occupancyHoleLabelPosition(
              hole.x,
              hole.y,
              center,
              radius,
              INNER,
              14,
            );
            const lx = label.lx + MARGIN;
            const ly = label.ly + MARGIN;
            const isTarget = targetId != null && hole.id === targetId;
            const displayNum = hole.id + 1;
            return (
              <g
                key={hole.id}
                data-testid={isTarget ? 'occupancy-target-hole' : 'occupancy-hole-marker'}
                data-hole-display={displayNum}
              >
                <circle
                  cx={p.cx}
                  cy={p.cy}
                  r={isTarget ? 4.5 : 2.5}
                  fill={isTarget ? '#111' : '#fff'}
                  stroke={isTarget ? '#005ea2' : '#333'}
                  strokeWidth={isTarget ? 2 : 1}
                />
                <text
                  x={lx}
                  y={ly}
                  fontSize={8}
                  fontWeight={600}
                  textAnchor={label.anchor}
                  dominantBaseline="middle"
                  fill="#111"
                  stroke="#fff"
                  strokeWidth={2.5}
                  paintOrder="stroke"
                  className={styles.occupancyHoleLabel}
                  data-testid="occupancy-hole-label"
                >
                  {displayNum}
                </text>
                <title>{`Hole ${displayNum}${isTarget ? ' (confirmed protocol target)' : ''}`}</title>
              </g>
            );
          })}
        </svg>

        <div className={styles.occupancyLegendPanel} data-testid="occupancy-color-legend">
          <p className={styles.occupancyLegendTitle}>Accumulated time per bin (s)</p>
          <svg width={LEGEND_WIDTH} height={18} aria-hidden="true">
            <defs>
              <linearGradient id="occupancy-legend-gradient" x1="0" y1="0" x2="1" y2="0">
                {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                  <stop key={t} offset={t} stopColor={occupancyCellColor(t)} />
                ))}
              </linearGradient>
            </defs>
            <rect x={0} y={2} width={LEGEND_WIDTH} height={14} fill="url(#occupancy-legend-gradient)" stroke="#666" strokeWidth={0.75} />
          </svg>
          <div className={styles.occupancyLegendTicks}>
            <span>0 s</span>
            <span>{(maxBinSec / 2).toFixed(2)} s</span>
            <span data-testid="occupancy-max-bin-sec">{maxBinSec.toFixed(2)} s max bin</span>
          </div>
          <p className={styles.hint} data-testid="occupancy-legend-note">
            Linear scale: bin shading proportional to seconds accumulated in that bin (darkest = max bin).
          </p>
        </div>
      </div>

      <dl className={styles.accountingGrid} data-testid="occupancy-accounting">
        <dt>Trial duration</dt>
        <dd data-testid="occupancy-trial-duration">{accounting.trialDurationSec.toFixed(2)} s</dd>
        <dt>Included weighted time (on platform)</dt>
        <dd data-testid="occupancy-included-sec">{accounting.includedWeightSec.toFixed(2)} s</dd>
        <dt>Excluded — off platform</dt>
        <dd data-testid="occupancy-excluded-off-platform">{accounting.excludedOffPlatformSec.toFixed(2)} s</dd>
        <dt>Excluded — unsupported tracking gaps</dt>
        <dd data-testid="occupancy-excluded-gaps">{accounting.excludedGapSec.toFixed(2)} s</dd>
        <dt>Excluded — zero/duplicate Δt pairs</dt>
        <dd data-testid="occupancy-excluded-zero-dt">{accounting.excludedZeroDtPairs}</dd>
        <dt>Scale</dt>
        <dd>
          {geometry.pxPerCm
            ? `${geometry.pxPerCm.toFixed(2)} px/cm known`
            : 'Physical scale unknown — platform coordinates in px'}
        </dd>
      </dl>
    </figure>
  );
}
