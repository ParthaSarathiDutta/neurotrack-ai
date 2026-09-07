/** User-facing hole labels are 1–20; internal Hole.id remains 0–19. */

export function formatHoleDisplayId(internalId: number | null | undefined): string {
  if (internalId == null) return '—';
  return String(internalId + 1);
}

/** Parse display hole number (1–20) to internal id; returns null if invalid. */
export function parseHoleDisplayId(displayId: number): number | null {
  if (!Number.isFinite(displayId) || displayId < 1 || displayId > 20) return null;
  return Math.round(displayId) - 1;
}
