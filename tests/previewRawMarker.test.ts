import { describe, expect, it } from 'vitest';
import {
  drawPreviewRawGhostMarker,
  PREVIEW_RAW_MARKER_STROKE,
} from '../src/domain/overlay/previewRawMarker';

type MockOp =
  | { kind: 'line'; x: number; y: number }
  | { kind: 'arc'; x: number; y: number; r: number }
  | { kind: 'text'; text: string; x: number; y: number }
  | { kind: 'stroke' }
  | { kind: 'strokeStyle'; value: string };

function createMockCtx() {
  const ops: MockOp[] = [];
  let pendingLine: { x: number; y: number } | null = null;

  const ctx = {
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => {
      pendingLine = null;
    },
    moveTo: (x: number, y: number) => {
      pendingLine = { x, y };
    },
    lineTo: (x: number, y: number) => {
      if (pendingLine) {
        ops.push({ kind: 'line', x: pendingLine.x, y: pendingLine.y });
        ops.push({ kind: 'line', x, y });
      }
    },
    arc: (x: number, y: number, r: number) => {
      ops.push({ kind: 'arc', x, y, r });
    },
    stroke: () => ops.push({ kind: 'stroke' }),
    strokeText: (text: string, x: number, y: number) => {
      ops.push({ kind: 'text', text, x, y });
    },
    fillText: (text: string, x: number, y: number) => {
      ops.push({ kind: 'text', text, x, y });
    },
    set strokeStyle(value: string) {
      ops.push({ kind: 'strokeStyle', value });
    },
    set fillStyle(_value: string) {
      /* noop */
    },
    set lineWidth(_value: number) {
      /* noop */
    },
    set font(_value: string) {
      /* noop */
    },
    setLineDash: () => undefined,
  } as unknown as CanvasRenderingContext2D;

  return { ctx, ops };
}

describe('drawPreviewRawGhostMarker', () => {
  it('draws connector, halo ring, dashed raw ring, and Raw label', () => {
    const { ctx, ops } = createMockCtx();
    drawPreviewRawGhostMarker(ctx, { x: 120, y: 80 }, { x: 126, y: 84 });

    expect(ops.some((o) => o.kind === 'line')).toBe(true);
    const arcs = ops.filter((o) => o.kind === 'arc') as Array<{ kind: 'arc'; r: number }>;
    expect(arcs.length).toBeGreaterThanOrEqual(2);
    expect(arcs.some((a) => a.r >= 9)).toBe(true);
    expect(ops.some((o) => o.kind === 'text' && o.text === 'Raw')).toBe(true);
    expect(ops.some((o) => o.kind === 'strokeStyle' && o.value === PREVIEW_RAW_MARKER_STROKE)).toBe(
      true,
    );
  });

  it('skips connector when raw and preview overlap', () => {
    const { ctx, ops } = createMockCtx();
    drawPreviewRawGhostMarker(ctx, { x: 50, y: 50 }, { x: 50.2, y: 50.1 });
    expect(ops.some((o) => o.kind === 'line')).toBe(false);
    expect(ops.some((o) => o.kind === 'text' && o.text === 'Raw')).toBe(true);
  });

  it('draws raw marker without connector when preview point omitted', () => {
    const { ctx, ops } = createMockCtx();
    drawPreviewRawGhostMarker(ctx, { x: 10, y: 20 }, null);
    expect(ops.some((o) => o.kind === 'line')).toBe(false);
    expect(ops.filter((o) => o.kind === 'arc').length).toBeGreaterThanOrEqual(2);
  });
});
