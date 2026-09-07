import type { Geometry } from '../../domain/types';
import {
  buildOccupancyGrid,
  occupancyCellFraction,
} from '../../domain/visualization/occupancyGrid';
import type { Observation } from '../../domain/types';
import styles from '../../styles/app.module.css';

interface OccupancyHeatmapProps {
  observations: Observation[];
  geometry: Geometry;
  trialStartUs: number;
  censorUs: number;
}

const SVG_SIZE = 280;

export function OccupancyHeatmap({
  observations,
  geometry,
  trialStartUs,
  censorUs,
}: OccupancyHeatmapProps) {
  const model = buildOccupancyGrid(observations, geometry, trialStartUs, censorUs);
  const center = model.platformCenter;
  const radius = model.platformRadiusPx;
  const size = model.gridSize;

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

  return (
    <figure className={styles.vizFigure} data-testid="occupancy-heatmap">
      <figcaption>
        Time-weighted occupancy ({model.unitLabel}) — darker = more time spent
      </figcaption>
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
          r={(SVG_SIZE / 2) - 2}
          className={styles.occupancyPlatformOutline}
        />
        {Array.from({ length: size * size }, (_, idx) => {
          const row = Math.floor(idx / size);
          const col = idx % size;
          const weight = model.weights[idx] ?? 0;
          if (weight <= 0) return null;
          const frac = occupancyCellFraction(weight, model.totalWeightUs);
          const videoX = minX + ((col + 0.5) / size) * span;
          const videoY = minY + ((row + 0.5) / size) * span;
          if (Math.hypot(videoX - center.x, videoY - center.y) > radius) return null;
          const gray = Math.round(240 - frac * 200);
          return (
            <rect
              key={idx}
              x={col * cellPx}
              y={row * cellPx}
              width={cellPx}
              height={cellPx}
              fill={`rgb(${gray}, ${gray}, ${gray})`}
              data-testid="occupancy-cell"
            />
          );
        })}
      </svg>
      <ul className={styles.vizLegend}>
        <li>
          Total weighted time: {(model.totalWeightUs / 1_000_000).toFixed(2)} s in-trial
        </li>
        {model.excludedGapUs > 0 && (
          <li>Excluded unsupported gaps: {(model.excludedGapUs / 1_000_000).toFixed(2)} s</li>
        )}
        {model.excludedZeroDtPairs > 0 && (
          <li>Excluded zero/duplicate-Δt pairs: {model.excludedZeroDtPairs}</li>
        )}
        <li>Scale: {geometry.pxPerCm ? `${geometry.pxPerCm.toFixed(2)} px/cm known` : 'Physical scale unknown — platform coordinates in px'}</li>
      </ul>
    </figure>
  );
}
