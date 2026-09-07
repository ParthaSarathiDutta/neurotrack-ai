import { useEffect, useRef } from 'react';
import type { Observation } from '../../domain/types';
import {
  buildTrajectorySegments,
  trajectoryTimeColor,
} from '../../domain/visualization/trajectorySegments';
import { videoToDisplay, type VideoDisplayBox } from '../../domain/videoTransform';
import styles from '../../styles/app.module.css';

interface TrajectoryOverlayProps {
  observations: Observation[];
  displayBox: VideoDisplayBox;
  trialStartUs: number;
  censorUs: number;
  visible: boolean;
  currentFrameIndex: number;
}

function strokeForProvenance(
  provenance: ReturnType<typeof buildTrajectorySegments>[number]['provenance'],
): { dash: number[]; width: number } {
  switch (provenance) {
    case 'manual':
      return { dash: [], width: 2.5 };
    case 'interpolated':
      return { dash: [5, 4], width: 2 };
    case 'smoothed':
      return { dash: [2, 3], width: 2 };
    case 'mixed':
      return { dash: [6, 3, 2, 3], width: 2 };
    default:
      return { dash: [], width: 2 };
  }
}

export function TrajectoryOverlay({
  observations,
  displayBox,
  trialStartUs,
  censorUs,
  visible,
  currentFrameIndex,
}: TrajectoryOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const segments = buildTrajectorySegments(observations, trialStartUs, censorUs);
  const trialSpanSec = Math.max(0.001, (censorUs - trialStartUs) / 1_000_000);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = displayBox.displayWidth * dpr;
    canvas.height = displayBox.displayHeight * dpr;
    canvas.style.width = `${displayBox.displayWidth}px`;
    canvas.style.height = `${displayBox.displayHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayBox.displayWidth, displayBox.displayHeight);

    if (!visible || segments.length === 0) return;

    for (const segment of segments) {
      const { dash, width } = strokeForProvenance(segment.provenance);
      ctx.setLineDash(dash);
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 1; i < segment.points.length; i += 1) {
        const prev = segment.points[i - 1]!;
        const curr = segment.points[i]!;
        const color = trajectoryTimeColor(curr.timeSec / trialSpanSec);
        ctx.strokeStyle = color;
        ctx.beginPath();
        const p0 = videoToDisplay({ x: prev.x, y: prev.y }, displayBox);
        const p1 = videoToDisplay({ x: curr.x, y: curr.y }, displayBox);
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();

        if (curr.frameIndex === currentFrameIndex) {
          ctx.setLineDash([]);
          ctx.fillStyle = '#0066cc';
          ctx.beginPath();
          ctx.arc(p1.x, p1.y, 5, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.lineWidth = width;
          ctx.setLineDash(dash);
        }
      }
    }
    ctx.setLineDash([]);
  }, [segments, displayBox, visible, currentFrameIndex, trialSpanSec]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.trajectoryOverlayCanvas}
      aria-hidden={!visible}
      data-testid="trajectory-overlay"
      data-visible={visible ? 'true' : 'false'}
    />
  );
}
