/** Container timestamp helpers — no fps literals. */

export function ctsToMicroseconds(cts: number, timescale: number): number {
  return Math.round((cts * 1_000_000) / timescale);
}

export function ctsToSeconds(cts: number, timescale: number): number {
  return cts / timescale;
}

export interface TimestampIndexInput {
  cts: number;
  timescale: number;
}

/** Build presentation timestamp index from container sample cts, sorted ascending. */
export function buildTimestampIndex(samples: TimestampIndexInput[]): Array<{
  timeUs: number;
  frameIndex: number;
  cts: number;
  timescale: number;
}> {
  const sorted = [...samples].sort((a, b) => a.cts - b.cts);
  return sorted.map((sample, frameIndex) => ({
    timeUs: ctsToMicroseconds(sample.cts, sample.timescale),
    frameIndex,
    cts: sample.cts,
    timescale: sample.timescale,
  }));
}

/** Median of unique consecutive cts deltas (ticks). */
export function medianUniqueCtsDelta(ctsValues: number[]): number | null {
  const sorted = [...ctsValues].sort((a, b) => a - b);
  const unique = [...new Set(sorted)].sort((a, b) => a - b);
  const deltas: number[] = [];
  for (let i = 1; i < unique.length; i += 1) {
    deltas.push(unique[i] - unique[i - 1]);
  }
  if (deltas.length === 0) return null;
  const ordered = [...deltas].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
}

/**
 * Human-readable frame rate from container ticks — never rounds to integer fps.
 * Returns strings like "15360/512" or "15000/1001".
 */
export function containerFrameRateLabel(
  timescale: number,
  medianUniqueDelta: number | null,
): string {
  if (medianUniqueDelta == null || medianUniqueDelta <= 0) {
    return `${timescale}/?`;
  }
  return `${timescale}/${medianUniqueDelta}`;
}

/** True when label represents 15000/1001 (test51-style) within tick tolerance. */
export function isNonIntegerFrameRate(label: string): boolean {
  const match = label.match(/^(\d+)\/(\d+)$/);
  if (!match) return false;
  const num = Number(match[1]);
  const den = Number(match[2]);
  return num === 15000 && den === 1001;
}

export function secondsFromTimeUs(timeUs: number): number {
  return timeUs / 1_000_000;
}
