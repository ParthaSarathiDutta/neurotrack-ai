/** High-contrast preview-only raw body indicator (not used outside cleaning preview). */
export const PREVIEW_RAW_MARKER_STROKE = '#c45c00';
export const PREVIEW_RAW_CONNECTOR_STROKE = 'rgba(196, 92, 0, 0.9)';

export interface DisplayPoint {
  x: number;
  y: number;
}

/** Draw connector, hollow raw ring, and label at display coordinates. Preview-only. */
export function drawPreviewRawGhostMarker(
  ctx: CanvasRenderingContext2D,
  rawPt: DisplayPoint,
  previewPt: DisplayPoint | null,
): void {
  if (previewPt) {
    const separation = Math.hypot(previewPt.x - rawPt.x, previewPt.y - rawPt.y);
    if (separation >= 0.5) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(rawPt.x, rawPt.y);
      ctx.lineTo(previewPt.x, previewPt.y);
      ctx.strokeStyle = PREVIEW_RAW_CONNECTOR_STROKE;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(rawPt.x, rawPt.y, 10, 0, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(rawPt.x, rawPt.y, 9, 0, 2 * Math.PI);
  ctx.strokeStyle = PREVIEW_RAW_MARKER_STROKE;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([5, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  const labelX = rawPt.x - 16;
  const labelY = rawPt.y - 13;
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText('Raw', labelX, labelY);
  ctx.fillStyle = PREVIEW_RAW_MARKER_STROKE;
  ctx.fillText('Raw', labelX, labelY);
  ctx.restore();
}
