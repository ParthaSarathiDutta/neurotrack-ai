import { describe, expect, it } from 'vitest';
import { estimatePose } from '../src/domain/tracking/animalPose';
import type { Blob } from '../src/domain/calibration/connectedComponents';
import { classifyMissingObservation } from '../src/domain/tracking/observationStatus';
import { computeTrackQuality } from '../src/domain/tracking/trackQuality';
import { processTrackingFrame, buildTrackingFrameContext } from '../src/domain/tracking/trackPipeline';
import { createInitialTrackerState } from '../src/domain/tracking/trackPipeline';
import { defaultTrackingParams } from '../src/domain/trialFactory';
import type { Geometry, Observation, TimestampIndexEntry } from '../src/domain/types';

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

  it('classifies rim disappearance as absent_in_hole when shrink pattern present', () => {
    const result = classifyMissingObservation(geometry, {
      lastPosition: { x: 510, y: 240 },
      recentAreas: [800, 700, 550, 400],
      recentCentroids: [],
    });
    expect(result.observed).toBe('absent_in_hole');
  });

  it('classifies mid-platform loss as lost', () => {
    const result = classifyMissingObservation(geometry, {
      lastPosition: { x: 320, y: 240 },
      recentAreas: [700, 680],
      recentCentroids: [],
    });
    expect(result.observed).toBe('lost');
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
