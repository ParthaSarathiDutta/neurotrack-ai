import { describe, expect, it } from 'vitest';
import { estimatePose } from '../src/domain/tracking/animalPose';
import type { Blob } from '../src/domain/calibration/connectedComponents';
import { classifyMissingObservation } from '../src/domain/tracking/observationStatus';
import {
  computeTrackQuality,
  groupFlaggedFrames,
  groupFlaggedFramesForReview,
} from '../src/domain/tracking/trackQuality';
import { processTrackingFrame, buildTrackingFrameContext } from '../src/domain/tracking/trackPipeline';
import { createInitialTrackerState } from '../src/domain/tracking/trackPipeline';
import { defaultTrackingParams } from '../src/domain/trialFactory';
import type { FlaggedFrame, Geometry, Observation, TimestampIndexEntry } from '../src/domain/types';

function elongatedBlob(cx: number, cy: number): Blob {
  const pixels: { x: number; y: number }[] = [];
  for (let x = cx - 8; x <= cx + 24; x += 1) {
    for (let y = cy - 3; y <= cy + 3; y += 1) {
      pixels.push({ x, y });
    }
  }
  return {
    label: 0,
    area: pixels.length,
    centroid: { x: cx + 8, y: cy },
    pixels,
    compactness: 0.35,
  };
}

/** Wide block (x 92-99) fused to a thin strip (x 100-124) — a shape with a genuine
 *  wide/thin asymmetry, used to test heading-vs-shape agreement/contradiction. */
function wedgeBlob(): Blob {
  const pixels: { x: number; y: number }[] = [];
  for (let x = 92; x <= 99; x += 1) {
    for (let y = 94; y <= 106; y += 1) pixels.push({ x, y });
  }
  for (let x = 100; x <= 124; x += 1) {
    for (let y = 99; y <= 101; y += 1) pixels.push({ x, y });
  }
  return {
    label: 0,
    area: pixels.length,
    centroid: { x: 108, y: 100 },
    pixels,
    compactness: 0.3,
  };
}

/** Same wedge shape but clipped against the frame edge (x <= 3). */
function rimClippedWedgeBlob(): Blob {
  const blob = wedgeBlob();
  return {
    ...blob,
    pixels: blob.pixels.map((p) => ({ x: p.x - 90, y: p.y })),
  };
}

describe('animalPose', () => {
  it('returns null nose when heading is unknown', () => {
    const blob = elongatedBlob(100, 100);
    const pose = estimatePose(blob, [], 640, 480);
    expect(pose.noseXY).toBeNull();
    expect(pose.qualityFlags).toContain('ambiguous_head_tail');
  });

  it('estimates nose when heading is consistent', () => {
    const blob = elongatedBlob(100, 100);
    const history = [
      { x: 60, y: 100 },
      { x: 80, y: 100 },
      { x: 95, y: 100 },
    ];
    const pose = estimatePose(blob, history, 640, 480);
    expect(pose.noseXY).not.toBeNull();
  });

  it('estimates nose when heading agrees with the wide/thin shape asymmetry', () => {
    const blob = wedgeBlob();
    // Moving toward the wide end (decreasing x) — heading and shape agree.
    const history = [
      { x: 150, y: 100 },
      { x: 130, y: 100 },
    ];
    const pose = estimatePose(blob, history, 640, 480);
    expect(pose.noseXY).not.toBeNull();
    expect(pose.noseXY?.x).toBeLessThan(108);
  });

  it('returns null nose when heading contradicts the wide/thin shape asymmetry', () => {
    const blob = wedgeBlob();
    // Moving toward the thin end (increasing x) while shape says that end is thin —
    // independent signals disagree, so no nose should be guessed.
    const history = [
      { x: 70, y: 100 },
      { x: 90, y: 100 },
    ];
    const pose = estimatePose(blob, history, 640, 480);
    expect(pose.noseXY).toBeNull();
    expect(pose.qualityFlags).toContain('ambiguous_head_tail');
  });

  it('returns null nose for a rim-clipped blob even with strong heading', () => {
    const blob = rimClippedWedgeBlob();
    const history = [
      { x: 60, y: 100 },
      { x: 40, y: 100 },
    ];
    const pose = estimatePose(blob, history, 640, 480);
    expect(pose.noseXY).toBeNull();
    expect(pose.qualityFlags).toContain('possible_occlusion');
    expect(pose.qualityFlags).toContain('ambiguous_head_tail');
  });
});

describe('observationStatus', () => {
  const geometry: Geometry = {
    platformCenter: { x: 320, y: 240 },
    platformRadiusPx: 200,
    holes: [{ id: 0, x: 520, y: 240, source: 'detected', confidence: 1 }],
    targetHoleId: 0,
    proposedTargetHoleId: 0,
    targetHoleConfirmedAt: null,
    pxPerCm: null,
    diameterCm: null,
    ringRotationDeg: null,
    source: 'auto',
    templateSourceTrialId: null,
    confirmedAt: 'x',
    calibrationReviewAcknowledgedAt: null,
    detection: null,
  };

  it('classifies rim disappearance as absent_in_hole when temporal evidence is strong', () => {
    const result = classifyMissingObservation(
      geometry,
      {
        lastPosition: { x: 510, y: 240 },
        recentAreas: [800, 700, 550, 300],
        recentCentroids: [],
      },
      {
        consecutiveMissingFrames: 3,
        peakRecentArea: 800,
        holeProximityStreak: 3,
      },
    );
    expect(result.observed).toBe('absent_in_hole');
  });

  it('classifies a single missed frame near a hole as lost', () => {
    const result = classifyMissingObservation(
      geometry,
      {
        lastPosition: { x: 510, y: 240 },
        recentAreas: [800, 700, 550, 400],
        recentCentroids: [],
      },
      {
        consecutiveMissingFrames: 1,
        peakRecentArea: 800,
        holeProximityStreak: 3,
      },
    );
    expect(result.observed).toBe('lost');
  });

  it('classifies partial shrink near a hole as lost when blob remnant is still large', () => {
    const result = classifyMissingObservation(
      geometry,
      {
        lastPosition: { x: 510, y: 240 },
        recentAreas: [800, 700, 650, 600],
        recentCentroids: [],
      },
      {
        consecutiveMissingFrames: 4,
        peakRecentArea: 800,
        holeProximityStreak: 4,
      },
    );
    expect(result.observed).toBe('lost');
  });

  it('classifies mid-platform loss as lost', () => {
    const result = classifyMissingObservation(
      geometry,
      {
        lastPosition: { x: 320, y: 240 },
        recentAreas: [700, 680],
        recentCentroids: [],
      },
      { consecutiveMissingFrames: 5, peakRecentArea: 700, holeProximityStreak: 0 },
    );
    expect(result.observed).toBe('lost');
  });

  it('classifies disappearance near a confirmed non-target hole as lost', () => {
    const confirmedGeometry: Geometry = {
      ...geometry,
      holes: [
        { id: 0, x: 520, y: 240, source: 'detected', confidence: 1 },
        { id: 1, x: 120, y: 240, source: 'detected', confidence: 1 },
      ],
      targetHoleId: 1,
      targetHoleConfirmedAt: '2026-01-01T00:00:00.000Z',
    };
    // Disappearance is near hole 0 (a known non-target, dead-end hole per task reference),
    // not near the confirmed target (hole 1) — must not become absent_in_hole.
    const result = classifyMissingObservation(
      confirmedGeometry,
      {
        lastPosition: { x: 510, y: 240 },
        recentAreas: [800, 700, 550, 400],
        recentCentroids: [],
      },
      { consecutiveMissingFrames: 3, peakRecentArea: 800, holeProximityStreak: 3 },
    );
    expect(result.observed).toBe('lost');
  });

  it('classifies disappearance near the confirmed target hole as absent_in_hole', () => {
    const confirmedGeometry: Geometry = {
      ...geometry,
      targetHoleConfirmedAt: '2026-01-01T00:00:00.000Z',
    };
    const result = classifyMissingObservation(
      confirmedGeometry,
      {
        lastPosition: { x: 510, y: 240 },
        recentAreas: [800, 700, 550, 300],
        recentCentroids: [],
      },
      { consecutiveMissingFrames: 3, peakRecentArea: 800, holeProximityStreak: 3 },
    );
    expect(result.observed).toBe('absent_in_hole');
  });

  it('classifies disappearance away from any real hole as lost, even with shrink evidence', () => {
    const result = classifyMissingObservation(
      geometry,
      {
        lastPosition: { x: 320, y: 430 },
        recentAreas: [800, 700, 550, 300],
        recentCentroids: [],
      },
      { consecutiveMissingFrames: 4, peakRecentArea: 800, holeProximityStreak: 2 },
    );
    expect(result.observed).toBe('lost');
  });

  it('classifies disappearance near a hole with no shrink/slow evidence as lost', () => {
    const result = classifyMissingObservation(
      geometry,
      {
        lastPosition: { x: 510, y: 240 },
        recentAreas: [700, 690, 685, 680],
        recentCentroids: [],
      },
      { consecutiveMissingFrames: 4, peakRecentArea: 700, holeProximityStreak: 3 },
    );
    expect(result.observed).toBe('lost');
  });
});

describe('groupFlaggedFramesForReview', () => {
  it('collapses granular flags into three scientist-facing groups', () => {
    const frames: FlaggedFrame[] = [
      { frameIndex: 1, timeUs: 1_000_000, reason: 'lost' },
      { frameIndex: 1, timeUs: 1_000_000, reason: 'low_confidence' },
      { frameIndex: 2, timeUs: 2_000_000, reason: 'absent_in_hole' },
      { frameIndex: 3, timeUs: 3_000_000, reason: 'ambiguous_head_tail' },
    ];
    const groups = groupFlaggedFramesForReview(frames);
    expect(groups).toHaveLength(3);
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.frames.length]));
    expect(byKey.tracking_issues).toBe(1);
    expect(byKey.pose_uncertainty).toBe(1);
    expect(byKey.hole_disappearance).toBe(1);
    const tracking = groups.find((g) => g.key === 'tracking_issues')!;
    expect(tracking.frames[0].specificReasons).toEqual(expect.arrayContaining(['lost', 'low_confidence']));
  });
});

describe('groupFlaggedFrames', () => {
  it('separates absent_in_hole from lost and does not let one category crowd another', () => {
    const frames: FlaggedFrame[] = [
      { frameIndex: 1, timeUs: 1_000_000, reason: 'lost' },
      { frameIndex: 2, timeUs: 2_000_000, reason: 'absent_in_hole' },
      { frameIndex: 2, timeUs: 2_000_000, reason: 'near_hole_disappearance' },
      { frameIndex: 3, timeUs: 3_000_000, reason: 'ambiguous_head_tail' },
      { frameIndex: 4, timeUs: 4_000_000, reason: 'low_confidence' },
      { frameIndex: 5, timeUs: 5_000_000, reason: 'speed_outlier' },
    ];
    const categories = groupFlaggedFrames(frames);
    const byKey = Object.fromEntries(categories.map((c) => [c.key, c.frames.length]));
    expect(byKey.lost).toBe(1);
    expect(byKey.absent_in_hole).toBe(1);
    expect(byKey.ambiguous_head_tail).toBe(1);
    expect(byKey.low_confidence).toBe(1);
    expect(byKey.speed_outlier).toBe(1);
  });
});

describe('trackQuality', () => {
  it('aggregates observation counts consistently', () => {
    const obs: Observation[] = [
      {
        timeUs: 0,
        frameIndex: 0,
        bodyXY: null,
        noseXY: null,
        confidence: 0,
        observed: 'absent_pre_trial',
        origin: 'auto',
        qualityFlags: null,
      },
      {
        timeUs: 1,
        frameIndex: 1,
        bodyXY: { x: 1, y: 1 },
        noseXY: null,
        confidence: 0.8,
        observed: 'tracked',
        origin: 'auto',
        qualityFlags: null,
      },
      {
        timeUs: 2,
        frameIndex: 2,
        bodyXY: null,
        noseXY: null,
        confidence: 0,
        observed: 'lost',
        origin: 'auto',
        qualityFlags: null,
      },
    ];
    const q = computeTrackQuality(obs, defaultTrackingParams());
    expect(q.totalFrames).toBe(3);
    expect(q.trackedCount + q.lostCount + 1).toBe(3);
  });
});

describe('processTrackingFrame pre-trial', () => {
  it('marks pre-window frames absent_pre_trial without CV', () => {
    const w = 8;
    const h = 8;
    const bg = new Uint8ClampedArray(w * h * 4).fill(200);
    const frame = new Uint8ClampedArray(w * h * 4).fill(200);
    const geometry: Geometry = {
      platformCenter: { x: 4, y: 4 },
      platformRadiusPx: 4,
      holes: [],
      targetHoleId: null,
      proposedTargetHoleId: null,
      targetHoleConfirmedAt: null,
      pxPerCm: null,
      diameterCm: null,
      ringRotationDeg: null,
      source: 'auto',
      templateSourceTrialId: null,
      confirmedAt: 'x',
      calibrationReviewAcknowledgedAt: null,
      detection: null,
    };
    const ctx = buildTrackingFrameContext(
      w,
      h,
      bg,
      geometry,
      { startTimeUs: 5_000_000, endTimeUs: 10_000_000, cutoffSeconds: 180, source: 'auto', proposedStartTimeUs: null, proposedEndTimeUs: null, confirmedAt: null, motionOnsetConfidence: null, detectionFailureReason: null },
      defaultTrackingParams(),
    );
    const entry: TimestampIndexEntry = {
      timeUs: 1_000_000,
      frameIndex: 0,
      cts: 0,
      timescale: 1,
    };
    const { observation } = processTrackingFrame(
      ctx,
      createInitialTrackerState(),
      frame,
      entry,
      null,
    );
    expect(observation.observed).toBe('absent_pre_trial');
    expect(observation.bodyXY).toBeNull();
  });
});
