import { describe, expect, it } from 'vitest';
import {
  BODY_ENTRY_DEFINITION_ID,
  BODY_ENTRY_DEFINITION_VERSION,
  buildBodyEntryFrameMetrics,
  detectBodyEntryCompletion,
} from '../src/domain/events/bodyEntry';
import { detectEscapeOutcome } from '../src/domain/events/escape';
import { defaultEventDetectionParams } from '../src/domain/trialFactory';
import type { Geometry, Observation } from '../src/domain/types';

const params = defaultEventDetectionParams();
const geometry: Geometry = {
  platformCenter: { x: 320, y: 240 },
  platformRadiusPx: 200,
  holes: [{ id: 1, x: 520, y: 240, source: 'detected', confidence: 1 }],
  targetHoleId: null,
  proposedTargetHoleId: null,
  targetHoleConfirmedAt: null,
  pxPerCm: 10,
  diameterCm: 40,
  ringRotationDeg: 0,
  source: 'auto',
  templateSourceTrialId: null,
  confirmedAt: 'x',
  calibrationReviewAcknowledgedAt: null,
  detection: null,
};
const hole = geometry.holes[0]!;

function obs(frameIndex: number, timeUs: number, body: { x: number; y: number }): Observation {
  return {
    frameIndex,
    timeUs,
    bodyXY: body,
    noseXY: { x: body.x, y: body.y - 4 },
    confidence: 0.9,
    observed: 'tracked',
    origin: 'auto',
    qualityFlags: null,
  };
}

function makeInput(
  frames: number[],
  areas: number[],
  darkenings: number[],
  bodies: Array<{ x: number; y: number }>,
  censorFrameIndex: number,
) {
  const observationsByFrame = new Map<number, Observation>();
  const timeUsByFrame = new Map<number, number>();
  frames.forEach((fi, i) => {
    timeUsByFrame.set(fi, 5_000_000 + fi * 100_000);
    observationsByFrame.set(fi, obs(fi, 5_000_000 + fi * 100_000, bodies[i]!));
  });
  return {
    frameIndices: frames,
    timeUsByFrame,
    platformBlobAreas: areas,
    holeDarkenings: darkenings,
    observationsByFrame,
    hole,
    platformRadiusPx: 200,
    params,
    censorFrameIndex,
  };
}

describe('neurotrack_body_entry v1', () => {
  it('documents versioned definition id', () => {
    expect(BODY_ENTRY_DEFINITION_ID).toBe('neurotrack_body_entry');
    expect(BODY_ENTRY_DEFINITION_VERSION).toBe('1');
  });

  it('accepts body entry with visible tail (reduced platform area, not zero)', () => {
    const nearHole = { x: 518, y: 240 };
    const result = detectBodyEntryCompletion(
      makeInput(
        [10, 11, 12],
        [5000, 2800, 2600],
        [0.15, 0.2, 0.22],
        [nearHole, nearHole, nearHole],
        12,
      ),
    );
    expect(result.established).toBe(true);
    expect(result.completionFrameIndex).toBe(11);
    expect(result.frameMetrics[2]!.platformBlobArea).toBeGreaterThan(0);
  });

  it('rejects incomplete torso entry (rim proximity without pixel entry)', () => {
    const rim = { x: 500, y: 240 };
    const result = detectBodyEntryCompletion(
      makeInput(
        [20, 21],
        [4800, 4500],
        [0.05, 0.06],
        [rim, rim],
        21,
      ),
    );
    expect(result.established).toBe(false);
    expect(result.failureReason).toBe('no_temporally_supported_body_entry');
  });

  it('detects genuine completion with temporal support', () => {
    const deep = { x: 519, y: 240 };
    const result = detectBodyEntryCompletion(
      makeInput(
        [30, 31, 32, 33],
        [6000, 3500, 3000, 2900],
        [0.15, 0.18, 0.2, 0.21],
        [deep, deep, deep, deep],
        33,
      ),
    );
    expect(result.established).toBe(true);
    expect(result.temporalSupportFrames).toBeGreaterThanOrEqual(2);
    expect(result.completionFrameIndex).toBe(31);
  });

  it('rejects nose poke without torso proximity', () => {
    const metrics = buildBodyEntryFrameMetrics(
      makeInput([5], [5000], [0.2], [{ x: 480, y: 240 }], 5),
    );
    expect(metrics[0]!.meetsTorsoProximity).toBe(false);
    expect(metrics[0]!.meetsBodyEntry).toBe(false);
  });

  it('allows completion at recording boundary when temporally supported', () => {
    const deep = { x: 519, y: 240 };
    const result = detectBodyEntryCompletion(
      makeInput(
        [96, 97, 98, 99, 100],
        [6000, 6000, 1800, 1800, 1800],
        [0.05, 0.06, 0.15, 0.2, 0.22],
        [deep, deep, deep, deep, deep],
        100,
      ),
    );
    expect(result.established).toBe(true);
    expect(result.completionFrameIndex).toBe(98);
  });

  it('rejects recording-end fallback when only final frame qualifies', () => {
    const deep = { x: 519, y: 240 };
    const result = detectBodyEntryCompletion(
      makeInput(
        [99, 100],
        [4500, 2400],
        [0.05, 0.22],
        [{ x: 500, y: 240 }, deep],
        100,
      ),
    );
    expect(result.established).toBe(false);
    expect(result.failureReason).toBe('no_temporally_supported_body_entry');
  });

  it('does not classify escape_completed from aggregate decay alone', () => {
    const holeTarget = geometry.holes[0]!;
    const observations: Observation[] = [];
    for (let i = 0; i < 80; i += 1) {
      observations.push(obs(i, 5_000_000 + i * 100_000, { x: holeTarget.x - 2, y: holeTarget.y }));
    }
    const ts = observations.map((o) => ({ timeUs: o.timeUs, frameIndex: o.frameIndex }));
    const esc = detectEscapeOutcome(
      observations,
      geometry,
      {
        startTimeUs: 5_000_000,
        endTimeUs: 30_000_000,
        cutoffSeconds: null,
        proposedStartTimeUs: 5_000_000,
        proposedEndTimeUs: 30_000_000,
        confirmedAt: 'x',
        motionOnsetConfidence: 1,
        detectionFailureReason: null,
        source: 'manual',
      },
      ts,
      params,
      {
        pixelEvidence: {
          framesAnalyzed: 50,
          framesRequested: 50,
          complete: true,
          areaDecayScore: 0.9,
          holeDarkeningScore: 0.8,
          bodyEntry: {
            established: false,
            completionFrameIndex: null,
            completionTimeUs: null,
            temporalSupportFrames: 0,
            definitionId: BODY_ENTRY_DEFINITION_ID,
            definitionVersion: BODY_ENTRY_DEFINITION_VERSION,
            areaDecayScore: 0.9,
            failureReason: 'no_temporally_supported_body_entry',
            frameMetrics: [],
          },
        },
      },
    );
    expect(esc?.type).not.toBe('escape_completed');
    expect(esc?.type).toBe('escape_incomplete_censored');
    expect(esc?.evidence.body_entry_not_established).toBe(true);
  });

  it('classifies escape_completed when body entry is established', () => {
    const observations: Observation[] = [];
    for (let i = 0; i < 120; i += 1) {
      observations.push(obs(i, 5_000_000 + i * 100_000, { x: 519, y: 240 }));
    }
    const ts = observations.map((o) => ({ timeUs: o.timeUs, frameIndex: o.frameIndex }));
    const esc = detectEscapeOutcome(
      observations,
      geometry,
      {
        startTimeUs: 5_000_000,
        endTimeUs: 17_000_000,
        cutoffSeconds: null,
        proposedStartTimeUs: 5_000_000,
        proposedEndTimeUs: 17_000_000,
        confirmedAt: 'x',
        motionOnsetConfidence: 1,
        detectionFailureReason: null,
        source: 'manual',
      },
      ts,
      params,
      {
        pixelEvidence: {
          framesAnalyzed: 50,
          framesRequested: 50,
          complete: true,
          areaDecayScore: 0.5,
          holeDarkeningScore: 0.3,
          bodyEntry: {
            established: true,
            completionFrameIndex: 90,
            completionTimeUs: 14_000_000,
            temporalSupportFrames: 3,
            definitionId: BODY_ENTRY_DEFINITION_ID,
            definitionVersion: BODY_ENTRY_DEFINITION_VERSION,
            areaDecayScore: 0.5,
            failureReason: null,
            frameMetrics: [],
          },
        },
      },
    );
    expect(esc?.type).toBe('escape_completed');
    expect(esc?.completionTimeUs).toBe(14_000_000);
    expect(esc?.completionTimeUs).not.toBe(esc?.censorBoundaryTimeUs);
  });
});
