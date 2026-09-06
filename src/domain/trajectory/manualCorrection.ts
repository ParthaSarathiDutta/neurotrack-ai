import type { ManualCorrection, Observation } from '../types';

/** Apply manual corrections over raw automatic observations — raw array is never mutated. */
export function applyManualCorrections(
  raw: Observation[],
  corrections: ManualCorrection[],
): Observation[] {
  if (corrections.length === 0) return raw;
  const byFrame = new Map(corrections.map((c) => [c.frameIndex, c]));
  return raw.map((obs) => {
    const corr = byFrame.get(obs.frameIndex);
    if (!corr) return obs;
    const hasBody = corr.bodyXY != null;
    return {
      ...obs,
      bodyXY: corr.bodyXY,
      noseXY: corr.noseXY,
      origin: 'manual',
      observed: hasBody ? 'tracked' : obs.observed,
      confidence: hasBody ? 1 : obs.confidence,
      qualityFlags: hasBody ? null : obs.qualityFlags,
    };
  });
}

export function upsertManualCorrection(
  corrections: ManualCorrection[],
  correction: ManualCorrection,
): ManualCorrection[] {
  const rest = corrections.filter((c) => c.frameIndex !== correction.frameIndex);
  return [...rest, correction];
}

export function removeManualCorrection(
  corrections: ManualCorrection[],
  frameIndex: number,
): ManualCorrection[] {
  return corrections.filter((c) => c.frameIndex !== frameIndex);
}

export function getManualCorrection(
  corrections: ManualCorrection[],
  frameIndex: number,
): ManualCorrection | null {
  return corrections.find((c) => c.frameIndex === frameIndex) ?? null;
}
