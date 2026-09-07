import type { Geometry } from '../../domain/types';
import {
  buildOccupancyGrid,
  occupancyCellColor,
  occupancyDisplayIntensity,
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

const SVG_SIZE = 300;
const LEGEND_WIDTH = 200;

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
  const cellPx = SVG_SIZE / size;
  const maxBinSec = model.maxWeightUs / 1_000_000;

  return (
    <figure className={styles.vizFigure} data-testid="occupancy-heatmap">
      <figcaption>Time-weighted occupancy on platform</figcaption>
      <p className={styles.vizDescription} data-testid="occupancy-description">
        Darker blue bins indicate more accumulated time (seconds) at that platform location. This shows
        where the tracked body spent time — not escape direction, protocol target, or hole preference unless
        separately confirmed in events.
      </p>

      <div className={styles.occupancyLayout}>
        <svg
          width={SVG_SIZE}
          height={SVG_SIZE}
          role="img"
          aria-label="Occupancy heatmap on platform"
          className={styles.vizSvg}
          viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
        >
          <circle
            cx={SVG_SIZE / 2}
            cy={SVG_SIZE / 2}
            r={SVG_SIZE / 2 - 3}
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
                x={col * cellPx}
                y={row * cellPx}
                width={cellPx}
                height={cellPx}
                fill={occupancyCellColor(intensity)}
                data-testid="occupancy-cell"
                data-weight-sec={binSec.toFixed(3)}
              >
                <title>{`${binSec.toFixed(2)} s accumulated in bin`}</title>
              </rect>
            );
          })}

          {geometry.holes.map((hole) => {
            const p = videoToOccupancySvg(hole.x, hole.y, center, radius, SVG_SIZE);
            const isTarget = targetId != null && hole.id === targetId;
            const displayNum = hole.id + 1;
            return (
              <g key={hole.id} data-testid={isTarget ? 'occupancy-target-hole' : 'occupancy-hole-marker'}>
                <circle
                  cx={p.cx}
                  cy={p.cy}
                  r={isTarget ? 5 : 3}
                  fill={isTarget ? '#111' : '#fff'}
                  stroke={isTarget ? '#005ea2' : '#333'}
                  strokeWidth={isTarget ? 2 : 1}
                />
                <text
                  x={p.cx + 6}
                  y={p.cy - 4}
                  fontSize={9}
                  fill="#111"
                  className={styles.occupancyHoleLabel}
                >
                  {displayNum}
                </text>
                <title>{`Hole ${displayNum}${isTarget ? ' (confirmed protocol target)' : ''}`}</title>
              </g>
            );
          })}

          <line
            x1={SVG_SIZE / 2}
            y1={SVG_SIZE / 2}
            x2={SVG_SIZE / 2}
            y2={8}
            stroke="#666"
            strokeWidth={1}
            strokeDasharray="2 2"
            aria-hidden="true"
          />
          <text x={SVG_SIZE / 2 + 4} y={10} fontSize={8} fill="#666">
            platform up
          </text>
        </svg>

        <div className={styles.occupancyLegendPanel} data-testid="occupancy-color-legend">
          <p className={styles.occupancyLegendTitle}>Accumulated time per bin (s)</p>
          <svg width={LEGEND_WIDTH} height={16} aria-hidden="true">
            <defs>
              <linearGradient id="occupancy-legend-gradient" x1="0" y1="0" x2="1" y2="0">
                {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                  <stop key={t} offset={t} stopColor={occupancyCellColor(t)} />
                ))}
              </linearGradient>
            </defs>
            <rect x={0} y={2} width={LEGEND_WIDTH} height={12} fill="url(#occupancy-legend-gradient)" stroke="#888" strokeWidth={0.5} />
          </svg>
          <div className={styles.occupancyLegendTicks}>
            <span>0 s</span>
            <span>{(maxBinSec / 2).toFixed(2)} s</span>
            <span data-testid="occupancy-max-bin-sec">{maxBinSec.toFixed(2)} s max</span>
          </div>
          <p className={styles.hint}>
            Display: linear normalization ({model.displayNormalization}). Each bin shaded by its own
            accumulated seconds relative to the darkest bin ({maxBinSec.toFixed(2)} s).
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
