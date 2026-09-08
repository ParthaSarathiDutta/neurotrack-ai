import type { ManualCorrection, Observation } from '../types';

function bodiesEqual(
  a: { x: number; y: number } | null | undefined,
  b: { x: number; y: number } | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y;
}

/** Resolve effective nose after applying a manual correction layer over raw observations. */
export function resolveCorrectedNoseXY(
  raw: Observation | undefined,
  correction: ManualCorrection | undefined,
): { x: number; y: number } | null {
  if (!correction) return raw?.noseXY ?? null;
  if (correction.noseRemoved === true) return null;
  if (correction.noseXY != null) return correction.noseXY;
  if (correction.noseRemoved === false) return raw?.noseXY ?? null;
  // Legacy bundles: noseXY null without noseRemoved — infer intent from body change.
  if (correction.noseXY === null) {
    if (bodiesEqual(correction.bodyXY, raw?.bodyXY)) return null;
    return raw?.noseXY ?? null;
  }
  return raw?.noseXY ?? null;
}

export function isNoseExplicitlyRemoved(
  raw: Observation | undefined,
  correction: ManualCorrection | undefined,
): boolean {
  if (!correction) return false;
  if (correction.noseRemoved === true) return true;
  if (correction.noseRemoved === false) return false;
  return correction.noseXY === null && bodiesEqual(correction.bodyXY, raw?.bodyXY);
}

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
      noseXY: resolveCorrectedNoseXY(obs, corr),
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
  return resolveCorrectedNoseXY(raw, correction);
}

/** True when Remove nose would hide a currently visible nose estimate. */
export function canRemoveNoseEstimate(
  raw: Observation | undefined,
  correction: ManualCorrection | undefined,
): boolean {
  return effectiveNoseXY(raw, correction) != null;
}

export function buildBodyCorrection(
  frameIndex: number,
  timeUs: number,
  x: number,
  y: number,
  existing: ManualCorrection | undefined,
  correctedAt: string,
): ManualCorrection {
  return {
    frameIndex,
    timeUs,
    bodyXY: { x, y },
    noseXY: existing?.noseXY ?? null,
    noseRemoved: existing?.noseRemoved ?? false,
    correctedAt,
  };
}

export function buildManualNoseCorrection(
  frameIndex: number,
  timeUs: number,
  body: { x: number; y: number },
  x: number,
  y: number,
  correctedAt: string,
): ManualCorrection {
  return {
    frameIndex,
    timeUs,
    bodyXY: body,
    noseXY: { x, y },
    noseRemoved: false,
    correctedAt,
  };
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
    if (isNoseExplicitlyRemoved(raw, existing)) {
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
      noseRemoved: true,
      correctedAt,
    },
  };
}
