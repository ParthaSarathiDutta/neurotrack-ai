import type {
  FlaggedFrame,
  Observation,
  ObservationQualityFlag,
  TrackQuality,
  TrackingParams,
} from '../types';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function computeLongestLostGap(observations: Observation[]): {
  frames: number;
  timeUs: number;
} {
  let longest = 0;
  let longestUs = 0;
  let current = 0;
  let gapStartUs: number | null = null;

  for (let i = 0; i < observations.length; i += 1) {
    const obs = observations[i];
    if (obs.observed === 'lost') {
      if (current === 0) gapStartUs = obs.timeUs;
      current += 1;
    } else if (current > 0) {
      if (current > longest) {
        longest = current;
        const endUs = observations[i - 1]?.timeUs ?? 0;
        longestUs = gapStartUs != null ? endUs - gapStartUs : 0;
      }
      current = 0;
      gapStartUs = null;
    }
  }
  if (current > longest) {
    longest = current;
    const endUs = observations[observations.length - 1]?.timeUs ?? 0;
    longestUs = gapStartUs != null ? endUs - gapStartUs : 0;
  }

  return { frames: longest, timeUs: longestUs };
}

/**
 * Every review-worthy frame, uncapped — a busy category (e.g. many `lost` frames) must
 * never crowd out or hide frames from a rarer category. The review UI groups and paginates
 * this list per category (see `FLAGGED_FRAME_CATEGORIES`/`groupFlaggedFrames` below).
 */
function collectFlaggedFrames(observations: Observation[]): FlaggedFrame[] {
  const flagged: FlaggedFrame[] = [];
  for (const obs of observations) {
    if (obs.observed === 'lost') {
      flagged.push({ frameIndex: obs.frameIndex, timeUs: obs.timeUs, reason: 'lost' });
    }
    if (obs.observed === 'absent_in_hole') {
      flagged.push({ frameIndex: obs.frameIndex, timeUs: obs.timeUs, reason: 'absent_in_hole' });
    }
    if (obs.qualityFlags) {
      for (const flag of obs.qualityFlags) {
        // `near_hole_disappearance` is redundant with the `absent_in_hole` bucket above
        // (classifyMissingObservation only ever sets it alongside that status) — surfaced
        // in the raw list for technical detail, but not a separate review category.
        flagged.push({ frameIndex: obs.frameIndex, timeUs: obs.timeUs, reason: flag });
      }
    }
  }
  return flagged;
}

/** Named review categories shown in the UI, in display order. */
export const FLAGGED_FRAME_CATEGORIES: Array<{ key: FlaggedFrame['reason']; label: string }> = [
  { key: 'lost', label: 'Lost' },
  { key: 'absent_in_hole', label: 'Provisional absent-in-hole' },
  { key: 'ambiguous_head_tail', label: 'Ambiguous head/tail (no nose)' },
  { key: 'low_confidence', label: 'Low confidence' },
  { key: 'speed_outlier', label: 'Speed outlier' },
  { key: 'possible_occlusion', label: 'Possible occlusion' },
];

export interface FlaggedFrameCategory {
  key: FlaggedFrame['reason'];
  label: string;
  frames: FlaggedFrame[];
}

/** Group the flat flagged-frame list into named categories for review UX. */
export function groupFlaggedFrames(flaggedFrames: FlaggedFrame[]): FlaggedFrameCategory[] {
  return FLAGGED_FRAME_CATEGORIES.map(({ key, label }) => ({
    key,
    label,
    frames: flaggedFrames.filter((f) => f.reason === key),
  }));
}

function assessOverall(
  trackedFraction: number,
  lostFraction: number,
  lowConfidenceCount: number,
  trackedCount: number,
  speedOutlierCount: number,
): { assessment: TrackQuality['overallAssessment']; reasons: string[] } {
  const reasons: string[] = [];

  if (trackedCount === 0) {
    return { assessment: 'failed', reasons: ['No frames were successfully tracked.'] };
  }

  if (trackedFraction < 0.4) {
    reasons.push(`Only ${(trackedFraction * 100).toFixed(1)}% of frames tracked (below 40%).`);
  }
  if (lostFraction > 0.25) {
    reasons.push(`${(lostFraction * 100).toFixed(1)}% of frames marked lost.`);
  }
  if (trackedCount > 0 && lowConfidenceCount / trackedCount > 0.2) {
    reasons.push(
      `${((lowConfidenceCount / trackedCount) * 100).toFixed(1)}% of tracked frames are low confidence.`,
    );
  }
  if (trackedCount > 0 && speedOutlierCount / trackedCount > 0.05) {
    reasons.push(
      `${((speedOutlierCount / trackedCount) * 100).toFixed(1)}% of tracked frames have implausible jumps.`,
    );
  }

  if (trackedFraction < 0.4 || lostFraction > 0.35) {
    return { assessment: 'failed', reasons };
  }
  if (reasons.length > 0 || trackedFraction < 0.75) {
    if (trackedFraction < 0.75 && !reasons.some((r) => r.includes('tracked'))) {
      reasons.push(`Tracked fraction ${(trackedFraction * 100).toFixed(1)}% is below 75%.`);
    }
    return { assessment: 'low', reasons };
  }
  return { assessment: 'high', reasons: [] };
}

/** Aggregate observations into a TrackQuality report. */
export function computeTrackQuality(
  observations: Observation[],
  params: TrackingParams,
): TrackQuality {
  const totalFrames = observations.length;
  const preTrialCount = observations.filter((o) => o.observed === 'absent_pre_trial').length;
  const tracked = observations.filter((o) => o.observed === 'tracked');
  const lost = observations.filter((o) => o.observed === 'lost');
  const absentInHole = observations.filter((o) => o.observed === 'absent_in_hole');

  const trackedCount = tracked.length;
  const lostCount = lost.length;
  const inTrialFrames = totalFrames - preTrialCount;

  const confidences = tracked.map((o) => o.confidence);
  const lowConfidenceCount = tracked.filter(
    (o) => o.confidence < params.lowConfidenceThreshold,
  ).length;
  const speedOutlierCount = tracked.filter((o) =>
    o.qualityFlags?.includes('speed_outlier'),
  ).length;

  const gap = computeLongestLostGap(observations);
  const flaggedFrames = collectFlaggedFrames(observations);
  const { assessment, reasons } = assessOverall(
    inTrialFrames > 0 ? trackedCount / inTrialFrames : 0,
    inTrialFrames > 0 ? lostCount / inTrialFrames : 0,
    lowConfidenceCount,
    trackedCount,
    speedOutlierCount,
  );

  if (assessment !== 'high' && flaggedFrames.length === 0 && lostCount + lowConfidenceCount > 0) {
    reasons.push('Quality issues detected but no individual frames were flagged.');
  }

  return {
    totalFrames,
    trackedCount,
    trackedFraction: inTrialFrames > 0 ? trackedCount / inTrialFrames : 0,
    lostCount,
    lostFraction: inTrialFrames > 0 ? lostCount / inTrialFrames : 0,
    absentInHoleCount: absentInHole.length,
    longestLostGapFrames: gap.frames,
    longestLostGapUs: gap.timeUs,
    lowConfidenceCount,
    speedOutlierCount,
    meanConfidence: confidences.length
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0,
    medianConfidence: median(confidences),
    overallAssessment: assessment,
    assessmentReasons: reasons,
    flaggedFrames,
  };
}

export function isSpeedOutlier(
  from: { x: number; y: number },
  to: { x: number; y: number },
  deltaTimeUs: number,
  maxSpeedPxPerSec: number,
): boolean {
  if (deltaTimeUs <= 0) return false;
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const speed = dist / (deltaTimeUs / 1_000_000);
  return speed > maxSpeedPxPerSec;
}

export function mergeQualityFlags(
  existing: ObservationQualityFlag[] | null,
  added: ObservationQualityFlag[],
): ObservationQualityFlag[] | null {
  const set = new Set<ObservationQualityFlag>(existing ?? []);
  for (const f of added) set.add(f);
  return set.size > 0 ? [...set] : null;
}
