import { CLEANING_SMOOTHING_MIN_DISPLACEMENT_PX } from '../constants';
import type { CleaningParams, ManualCorrection, Observation, ObservationOrigin } from '../types';
import { mergeCleaningWithManual } from './resolveObservations';

const SMOOTHING_BLOCK_FLAGS = [
  'near_hole_disappearance',
  'possible_occlusion',
  'speed_outlier',
  'ambiguous_head_tail',
] as const;

export function bodyDisplacementPx(
  a: { x: number; y: number } | null | undefined,
  b: { x: number; y: number } | null | undefined,
): number | null {
  if (!a || !b) return null;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function isMeaningfulPreviewBodyChange(
  rawBody: { x: number; y: number } | null,
  previewBody: { x: number; y: number } | null,
): boolean {
  if (!previewBody) return false;
  if (!rawBody) return true;
  const displacement = bodyDisplacementPx(rawBody, previewBody);
  return displacement != null && displacement >= CLEANING_SMOOTHING_MIN_DISPLACEMENT_PX;
}

export interface CleaningPreviewFrameCompare {
  frameIndex: number;
  rawBody: { x: number; y: number } | null;
  previewBody: { x: number; y: number } | null;
  displacementPx: number | null;
  previewOrigin: ObservationOrigin | null;
  meaningfulChange: boolean;
  skipNote: string | null;
}

function formatCoord(n: number): string {
  return n.toFixed(1);
}

export function formatBodyXY(body: { x: number; y: number } | null): string {
  if (!body) return 'none';
  return `(${formatCoord(body.x)}, ${formatCoord(body.y)})`;
}

export function formatCleaningPreviewCompareLine(compare: CleaningPreviewFrameCompare): string {
  const parts = [
    `Raw body: ${formatBodyXY(compare.rawBody)} → Preview: ${formatBodyXY(compare.previewBody)}`,
  ];
  if (compare.displacementPx != null) {
    parts.push(`Δ = ${compare.displacementPx.toFixed(2)} px`);
  }
  if (compare.previewOrigin) {
    parts.push(`origin: ${compare.previewOrigin}`);
  }
  return parts.join(' · ');
}

function explainPreviewUnchanged(
  rawObs: Observation | null,
  previewObs: Observation | null,
  params: CleaningParams,
): string {
  if (!rawObs) return 'No observation on this frame.';
  if (rawObs.origin === 'manual') {
    return 'Manual correction anchors this frame; cleaning does not override it.';
  }
  if (!rawObs.bodyXY && !previewObs?.bodyXY) {
    if (rawObs.observed === 'lost') {
      return 'Gap not filled — ineligible or exceeds configured bounds.';
    }
    return 'No body position on this frame.';
  }
  if (params.smoothingWindow <= 1) {
    return 'Smoothing disabled (window ≤ 1).';
  }
  if (
    rawObs.qualityFlags?.some((f) =>
      SMOOTHING_BLOCK_FLAGS.includes(f as (typeof SMOOTHING_BLOCK_FLAGS)[number]),
    )
  ) {
    return 'Smoothing blocked by frame quality flags.';
  }
  if (rawObs.observed === 'absent_pre_trial' || rawObs.observed === 'absent_in_hole') {
    return 'Absence frames are never smoothed or gap-filled.';
  }
  return `Smoothing skipped: moving-average shift < ${CLEANING_SMOOTHING_MIN_DISPLACEMENT_PX} px at this frame (path already smooth).`;
}

/** Compare corrected-base vs effective preview at one frame for panel and overlay hints. */
export function compareCleaningPreviewFrame(
  correctedBase: Observation[],
  cleaningPreview: Observation[],
  manualCorrections: ManualCorrection[],
  frameIndex: number,
  params: CleaningParams,
): CleaningPreviewFrameCompare | null {
  const rawObs = correctedBase.find((o) => o.frameIndex === frameIndex) ?? null;
  const previewObs =
    mergeCleaningWithManual(correctedBase, cleaningPreview, manualCorrections).find(
      (o) => o.frameIndex === frameIndex,
    ) ?? null;

  if (!rawObs && !previewObs) return null;

  const rawBody = rawObs?.bodyXY ?? null;
  const previewBody = previewObs?.bodyXY ?? null;
  const displacementPx = bodyDisplacementPx(rawBody, previewBody);
  const meaningfulChange = isMeaningfulPreviewBodyChange(rawBody, previewBody);
  const skipNote = meaningfulChange
    ? null
    : explainPreviewUnchanged(rawObs, previewObs, params);

  return {
    frameIndex,
    rawBody,
    previewBody,
    displacementPx,
    previewOrigin: previewObs?.origin ?? null,
    meaningfulChange,
    skipNote,
  };
}
