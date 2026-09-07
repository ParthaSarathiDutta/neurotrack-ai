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

/** Effective nose position after applying manual corrections (null = unavailable). */
export function effectiveNoseXY(
  raw: Observation | undefined,
  correction: ManualCorrection | undefined,
): { x: number; y: number } | null {
  if (correction) return correction.noseXY;
  return raw?.noseXY ?? null;
}

/** True when Remove nose would hide a currently visible nose estimate. */
export function canRemoveNoseEstimate(
  raw: Observation | undefined,
  correction: ManualCorrection | undefined,
): boolean {
  return effectiveNoseXY(raw, correction) != null;
}

export type NoseRemovalOutcome =
  | { kind: 'ok'; correction: ManualCorrection }
  | { kind: 'no_body'; message: string }
  | { kind: 'no_nose'; message: string }
  | { kind: 'already_removed'; message: string };

/** Build a nose-removal correction or explain why removal is not possible. */
export function resolveNoseRemoval(
  frameIndex: number,
  timeUs: number,
  raw: Observation | undefined,
  existing: ManualCorrection | undefined,
  correctedAt: string,
): NoseRemovalOutcome {
  const body = existing?.bodyXY ?? raw?.bodyXY ?? null;
  if (!body) {
    return {
      kind: 'no_body',
      message: 'No tracked body on this frame — cannot mark nose unavailable.',
    };
  }
  if (!canRemoveNoseEstimate(raw, existing)) {
    if (existing?.noseXY === null) {
      return {
        kind: 'already_removed',
        message: 'Nose already marked unavailable on this frame.',
      };
    }
    return {
      kind: 'no_nose',
      message: 'No nose estimate on this frame.',
    };
  }
  return {
    kind: 'ok',
    correction: {
      frameIndex,
      timeUs,
      bodyXY: body,
      noseXY: null,
      correctedAt,
    },
  };
}
