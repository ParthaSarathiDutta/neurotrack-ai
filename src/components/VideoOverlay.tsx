import { useEffect, useRef } from 'react';
import type { Geometry, Observation } from '../domain/types';
import { videoToDisplay, displayToVideo, type VideoDisplayBox } from '../domain/videoTransform';
import styles from '../styles/app.module.css';

interface VideoOverlayProps {
  geometry: Geometry;
  displayBox: VideoDisplayBox;
  selectedHoleId: number | null;
  observation?: Observation | null;
  onHoleClick?: (holeId: number) => void;
  onCanvasClick?: (x: number, y: number) => void;
}

export function VideoOverlay({
  geometry,
  displayBox,
  selectedHoleId,
  observation,
  onHoleClick,
  onCanvasClick,
}: VideoOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    if (geometry.platformCenter && geometry.platformRadiusPx) {
      const center = videoToDisplay(geometry.platformCenter, displayBox);
      const edge = videoToDisplay(
        {
          x: geometry.platformCenter.x + geometry.platformRadiusPx,
          y: geometry.platformCenter.y,
        },
        displayBox,
      );
      const radiusPx = Math.hypot(edge.x - center.x, edge.y - center.y);

      ctx.beginPath();
      ctx.arc(center.x, center.y, radiusPx, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(40, 40, 40, 0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const hole of geometry.holes) {
      const p = videoToDisplay(hole, displayBox);
      const isTarget =
        hole.id === geometry.targetHoleId || hole.id === geometry.proposedTargetHoleId;
      const isSelected = hole.id === selectedHoleId;
      const r = isTarget ? 9 : 6;

      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);

      if (hole.source === 'manual') {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#111111';
        ctx.lineWidth = 2.5;
        ctx.fill();
        ctx.stroke();
      } else if (hole.source === 'detected') {
        ctx.fillStyle = isTarget ? '#111111' : 'rgba(30, 30, 30, 0.75)';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(120, 120, 120, 0.95)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (isTarget) {
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#111111';
        ctx.lineWidth = 3;
        ctx.strokeText('T', p.x - 4, p.y + 4);
        ctx.fillText('T', p.x - 4, p.y + 4);
      }

      if (isSelected) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 5, 0, 2 * Math.PI);
        ctx.strokeStyle = '#0066cc';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      const label = String(hole.id + 1);
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(label, p.x + 8, p.y - 8);
      ctx.fillStyle = '#111111';
      ctx.fillText(label, p.x + 8, p.y - 8);
    }

    if (observation?.bodyXY) {
      const body = videoToDisplay(observation.bodyXY, displayBox);
      ctx.beginPath();
      if (observation.observed === 'tracked') {
        ctx.arc(body.x, body.y, 7, 0, 2 * Math.PI);
        ctx.fillStyle = '#111111';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.rect(body.x - 6, body.y - 6, 12, 12);
        ctx.strokeStyle = '#111111';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    if (observation?.noseXY) {
      const nose = videoToDisplay(observation.noseXY, displayBox);
      ctx.beginPath();
      ctx.moveTo(nose.x, nose.y - 8);
      ctx.lineTo(nose.x + 7, nose.y + 6);
      ctx.lineTo(nose.x - 7, nose.y + 6);
      ctx.closePath();
      ctx.fillStyle = '#111111';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (observation?.qualityFlags?.includes('ambiguous_head_tail') && observation.bodyXY) {
      const body = videoToDisplay(observation.bodyXY, displayBox);
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillStyle = '#111111';
      ctx.fillText('?', body.x + 10, body.y - 10);
    }
  }, [geometry, displayBox, selectedHoleId, observation]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const displayX = e.clientX - rect.left;
    const displayY = e.clientY - rect.top;

    if (onHoleClick && geometry.holes.length > 0) {
      let closest: { id: number; dist: number } | null = null;
      for (const hole of geometry.holes) {
        const p = videoToDisplay(hole, displayBox);
        const dist = Math.hypot(p.x - displayX, p.y - displayY);
        if (dist < 18 && (!closest || dist < closest.dist)) {
          closest = { id: hole.id, dist };
        }
      }
      if (closest) {
        onHoleClick(closest.id);
        return;
      }
    }

    if (onCanvasClick) {
      const videoPt = displayToVideo({ x: displayX, y: displayY }, displayBox);
      onCanvasClick(videoPt.x, videoPt.y);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className={styles.overlayCanvas}
      aria-label="Maze geometry overlay"
      data-testid="video-overlay"
      onClick={handleClick}
    />
  );
}
