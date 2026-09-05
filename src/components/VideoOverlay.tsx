import { useEffect, useRef } from 'react';
import type { Geometry } from '../domain/types';
import { videoToDisplay, type VideoDisplayBox } from '../domain/videoTransform';
import styles from '../styles/app.module.css';

interface VideoOverlayProps {
  geometry: Geometry;
  displayBox: VideoDisplayBox;
  selectedHoleId: number | null;
  onHoleClick?: (holeId: number) => void;
  onCanvasClick?: (x: number, y: number) => void;
}

export function VideoOverlay({
  geometry,
  displayBox,
  selectedHoleId,
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
      ctx.strokeStyle = '#333';
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
      const r = isTarget ? 8 : 5;

      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
      if (hole.source === 'manual') {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
      } else if (hole.source === 'detected') {
        ctx.fillStyle = isTarget ? '#000' : '#555';
        ctx.fill();
      } else {
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (isTarget) {
        ctx.font = 'bold 11px sans-serif';
        ctx.fillStyle = '#000';
        ctx.fillText('T', p.x - 4, p.y + 4);
      }
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 4, 0, 2 * Math.PI);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.font = '10px sans-serif';
      ctx.fillStyle = '#000';
      ctx.fillText(String(hole.id + 1), p.x + 6, p.y - 6);
    }
  }, [geometry, displayBox, selectedHoleId]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const displayX = e.clientX - rect.left;
    const displayY = e.clientY - rect.top;

    if (onHoleClick && geometry.holes.length > 0) {
      let closest: { id: number; dist: number } | null = null;
      for (const hole of geometry.holes) {
        const p = videoToDisplay(hole, displayBox);
        const dist = Math.hypot(p.x - displayX, p.y - displayY);
        if (dist < 15 && (!closest || dist < closest.dist)) {
          closest = { id: hole.id, dist };
        }
      }
      if (closest) {
        onHoleClick(closest.id);
        return;
      }
    }

    if (onCanvasClick) {
      const scaleX = displayBox.videoWidth / displayBox.displayWidth;
      const scaleY = displayBox.videoHeight / displayBox.displayHeight;
      onCanvasClick(displayX * scaleX, displayY * scaleY);
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
