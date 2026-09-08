/** Layout helpers for the hole-visit timeline SVG (display only — no scientific data). */

export function buildTimelineXTicks(durationSec: number): number[] {
  if (durationSec <= 0) return [0];
  const step =
    durationSec <= 15 ? 5 : durationSec <= 30 ? 10 : durationSec <= 60 ? 15 : 30;
  const ticks: number[] = [0];
  for (let t = step; t < durationSec; t += step) ticks.push(t);
  const last = ticks[ticks.length - 1]!;
  const minEndSep = Math.min(step * 0.2, 3);
  if (Math.abs(durationSec - last) < minEndSep) {
    ticks[ticks.length - 1] = durationSec;
  } else if (Math.abs(durationSec - last) > 0.001) {
    ticks.push(durationSec);
  }
  return ticks;
}

export function formatTimelineTickLabel(sec: number): string {
  return sec.toFixed(sec % 1 === 0 ? 0 : 1);
}

export function timelineXTickTextAnchor(
  index: number,
  tickCount: number,
): 'start' | 'middle' | 'end' {
  if (index === 0) return 'start';
  if (index === tickCount - 1) return 'end';
  return 'middle';
}

export function timelineXTickPosition(
  xAtSec: number,
  anchor: 'start' | 'middle' | 'end',
  plotLeft: number,
  width: number,
  rightPad: number,
): number {
  if (anchor === 'start') return Math.max(plotLeft, xAtSec);
  if (anchor === 'end') return Math.min(width - rightPad, xAtSec);
  return xAtSec;
}

export function censorRegionLabelLayout(
  censorX: number,
  width: number,
  rightPad: number,
): { x: number; textAnchor: 'end' } {
  return {
    x: Math.min(censorX - 4, width - rightPad),
    textAnchor: 'end',
  };
}

/** Minimum display separation (px) before coincident escape markers are nudged apart. */
const MARKER_COINCIDENT_PX = 7;
const MARKER_NUDGE_PX = 9;

/**
 * Assign optional horizontal display offsets (px) when escape markers would stack visually.
 * Frame indices and event times are unchanged — offsets affect rendered x only.
 */
export function escapeMarkerDisplayOffsets(
  markerSecs: number[],
  xForSec: (sec: number) => number,
): number[] {
  const offsets = markerSecs.map(() => 0);
  for (let i = 1; i < markerSecs.length; i += 1) {
    const baseX = xForSec(markerSecs[i]!) + offsets[i]!;
    for (let j = 0; j < i; j += 1) {
      const otherX = xForSec(markerSecs[j]!) + offsets[j]!;
      if (Math.abs(baseX - otherX) < MARKER_COINCIDENT_PX) {
        offsets[i] = offsets[j]! - MARKER_NUDGE_PX;
        break;
      }
    }
  }
  return offsets;
}

/** Estimate whether x-axis tick labels would overlap at the given scale (for regression tests). */
export function timelineXTicksOverlap(
  ticks: number[],
  durationSec: number,
  plotLeft: number,
  plotWidth: number,
  width: number,
  rightPad: number,
  charWidthPx = 7,
): boolean {
  if (ticks.length <= 1) return false;
  const boxes = ticks.map((sec, index) => {
    const anchor = timelineXTickTextAnchor(index, ticks.length);
    const xAt = plotLeft + (sec / durationSec) * plotWidth;
    const x = timelineXTickPosition(xAt, anchor, plotLeft, width, rightPad);
    const label = formatTimelineTickLabel(sec);
    const labelWidth = label.length * charWidthPx;
    if (anchor === 'start') return { left: x, right: x + labelWidth };
    if (anchor === 'end') return { left: x - labelWidth, right: x };
    return { left: x - labelWidth / 2, right: x + labelWidth / 2 };
  });
  for (let i = 1; i < boxes.length; i += 1) {
    if (boxes[i]!.left < boxes[i - 1]!.right - 2) return true;
  }
  if (boxes[boxes.length - 1]!.right > width - rightPad + 2) return true;
  return false;
}
