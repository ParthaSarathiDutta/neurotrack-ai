import { CLEANING_SMOOTHING_MIN_DISPLACEMENT_PX } from '../constants';
import type { AppliedCleaning, CleaningParams, ManualCorrection, Observation, ObservationOrigin, ObservationQualityFlag } from '../types';
import { formatCleaningQualityFlags } from './cleaningLabels';
import { isAppliedCleaningConsumable } from './cleaningStaleness';
import { mergeCleaningWithManual } from './resolveObservations';

const CLEANING_REASON_FLAGS: ObservationQualityFlag[] = [
  'gap_interpolated',
  'speed_outlier_replaced',
  'duplicate_pts_spatial_estimate',
];

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

/** Alias — same displacement threshold for applied cleaning comparisons. */
export const isMeaningfulAppliedBodyChange = isMeaningfulPreviewBodyChange;

export interface CleaningAppliedFrameCompare {
  frameIndex: number;
  correctedBody: { x: number; y: number } | null;
  appliedBody: { x: number; y: number } | null;
  displacementPx: number | null;
  appliedOrigin: ObservationOrigin | null;
  cleaningReason: string | null;
  meaningfulChange: boolean;
  unchangedNote: string | null;
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

export function describeAppliedCleaningReason(obs: Observation | null): string | null {
  if (!obs) return null;
  if (obs.origin === 'manual') return 'manual anchor (cleaning does not override)';
  const cleaningFlags = obs.qualityFlags?.filter((f) => CLEANING_REASON_FLAGS.includes(f)) ?? [];
  if (cleaningFlags.length) return formatCleaningQualityFlags(cleaningFlags);
  if (obs.origin === 'smoothed') return 'smoothed trajectory';
  if (obs.origin === 'interpolated') return 'interpolated gap fill';
  return null;
}

export function formatCleaningAppliedCompareLine(compare: CleaningAppliedFrameCompare): string {
  const parts = [
    `Corrected body: ${formatBodyXY(compare.correctedBody)} → Applied: ${formatBodyXY(compare.appliedBody)}`,
  ];
  if (compare.displacementPx != null) {
    parts.push(`Δ = ${compare.displacementPx.toFixed(2)} px`);
  }
  if (compare.appliedOrigin) {
    parts.push(`origin: ${compare.appliedOrigin}`);
  }
  if (compare.cleaningReason) {
    parts.push(compare.cleaningReason);
  }
  return parts.join(' · ');
}

function explainCleaningUnchanged(
  correctedObs: Observation | null,
  cleanedObs: Observation | null,
  params: CleaningParams,
  mode: 'preview' | 'applied',
): string {
  const prefix =
    mode === 'applied'
      ? 'Applied cleaning unchanged at this frame'
      : 'Preview unchanged at this frame';
  if (!correctedObs) return `${prefix} — no observation.`;
  if (correctedObs.origin === 'manual') {
    return `${prefix} — manual correction anchors this frame.`;
  }
  if (!correctedObs.bodyXY && !cleanedObs?.bodyXY) {
    if (correctedObs.observed === 'lost') {
      return `${prefix} — gap not filled (ineligible or exceeds configured bounds).`;
    }
    return `${prefix} — no body position.`;
  }
  if (params.smoothingWindow <= 1) {
    return `${prefix} — smoothing disabled (window ≤ 1).`;
  }
  if (
    correctedObs.qualityFlags?.some((f) =>
      SMOOTHING_BLOCK_FLAGS.includes(f as (typeof SMOOTHING_BLOCK_FLAGS)[number]),
    )
  ) {
    return `${prefix} — smoothing blocked by frame quality flags.`;
  }
  if (correctedObs.observed === 'absent_pre_trial' || correctedObs.observed === 'absent_in_hole') {
    return `${prefix} — absence frames are never cleaned.`;
  }
  return `${prefix} — body shift < ${CLEANING_SMOOTHING_MIN_DISPLACEMENT_PX} px (already smooth).`;
}

function explainPreviewUnchanged(
  rawObs: Observation | null,
  previewObs: Observation | null,
  params: CleaningParams,
): string {
  return explainCleaningUnchanged(rawObs, previewObs, params, 'preview');
}

/** Compare corrected-base vs stored applied cleaning at one frame (not preview). */
export function compareCleaningAppliedFrame(
  correctedBase: Observation[],
  appliedCleaning: AppliedCleaning,
  manualCorrections: ManualCorrection[],
  frameIndex: number,
  params: CleaningParams,
): CleaningAppliedFrameCompare | null {
  if (!isAppliedCleaningConsumable(appliedCleaning)) return null;

  const correctedObs = correctedBase.find((o) => o.frameIndex === frameIndex) ?? null;
  const storedAppliedObs =
    appliedCleaning.observations.find((o) => o.frameIndex === frameIndex) ?? null;
  const effectiveAppliedObs =
    mergeCleaningWithManual(correctedBase, appliedCleaning.observations, manualCorrections).find(
      (o) => o.frameIndex === frameIndex,
    ) ?? null;

  if (!correctedObs && !effectiveAppliedObs) return null;

  const correctedBody = correctedObs?.bodyXY ?? null;
  const appliedBody = effectiveAppliedObs?.bodyXY ?? null;
  const displacementPx = bodyDisplacementPx(correctedBody, appliedBody);
  const meaningfulChange = isMeaningfulAppliedBodyChange(correctedBody, appliedBody);
  const cleaningReason = describeAppliedCleaningReason(storedAppliedObs);
  const unchangedNote = meaningfulChange
    ? null
    : explainCleaningUnchanged(correctedObs, storedAppliedObs, params, 'applied');

  return {
    frameIndex,
    correctedBody,
    appliedBody,
    displacementPx,
    appliedOrigin: effectiveAppliedObs?.origin ?? null,
    cleaningReason,
    meaningfulChange,
    unchangedNote,
  };
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
