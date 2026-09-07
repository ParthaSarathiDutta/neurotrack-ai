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
const trialWindow = {
  startTimeUs: 5_000_000,
  endTimeUs: 30_000_000,
  cutoffSeconds: null,
  proposedStartTimeUs: 5_000_000,
  proposedEndTimeUs: 30_000_000,
  confirmedAt: 'x',
  motionOnsetConfidence: 1,
  detectionFailureReason: null,
  source: 'manual' as const,
};

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

function bodyEntryFromResult(result: ReturnType<typeof detectBodyEntryCompletion>) {
  return {
    completionEstablished: result.completionEstablished,
    completionFrameIndex: result.completionFrameIndex,
    completionTimeUs: result.completionTimeUs,
    completionTemporalSupportFrames: result.completionTemporalSupportFrames,
    completionPath: result.completionPath,
    possibleEntryEvidence: result.possibleEntryEvidence,
    possibleEntryFrameIndex: result.possibleEntryFrameIndex,
    possibleEntryTimeUs: result.possibleEntryTimeUs,
    possibleEntryTemporalSupportFrames: result.possibleEntryTemporalSupportFrames,
    established: result.completionEstablished,
    temporalSupportFrames: result.completionTemporalSupportFrames,
    definitionId: BODY_ENTRY_DEFINITION_ID,
    definitionVersion: BODY_ENTRY_DEFINITION_VERSION,
    areaDecayScore: result.areaDecayScore,
    failureReason: result.failureReason,
    frameMetrics: result.frameMetrics,
  };
}

describe('neurotrack_body_entry v3', () => {
  it('documents versioned definition id', () => {
    expect(BODY_ENTRY_DEFINITION_ID).toBe('neurotrack_body_entry');
    expect(BODY_ENTRY_DEFINITION_VERSION).toBe('3');
  });

  it('establishes completion on Path A with visible tail (reduced platform area, not zero)', () => {
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
    expect(result.completionEstablished).toBe(true);
    expect(result.completionFrameIndex).toBe(11);
    expect(result.completionPath).toBe('centroid_pixel');
    expect(result.possibleEntryEvidence).toBe(false);
    expect(result.frameMetrics[2]!.platformBlobArea).toBeGreaterThan(0);
  });

  it('treats occlusion-path pixels as possible entry evidence only, not auto completion', () => {
    const laggingCentroid = { x: 507, y: 240 };
    const result = detectBodyEntryCompletion(
      makeInput(
        [40, 41, 42],
        [5000, 2900, 2700],
        [0.14, 0.18, 0.22],
        [laggingCentroid, laggingCentroid, laggingCentroid],
        42,
      ),
    );
    expect(result.completionEstablished).toBe(false);
    expect(result.possibleEntryEvidence).toBe(true);
    expect(result.possibleEntryFrameIndex).toBe(41);
    expect(result.failureReason).toBe('possible_entry_only_occlusion_path');
    expect(result.frameMetrics.every((m) => !m.meetsTorsoProximity)).toBe(true);
    expect(result.frameMetrics.every((m) => m.meetsApproachProximity)).toBe(true);
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
    expect(result.completionEstablished).toBe(false);
    expect(result.possibleEntryEvidence).toBe(false);
    expect(result.failureReason).toBe('no_temporally_supported_body_entry');
  });

  it('rejects false rim entry with darkening but no platform area reduction', () => {
    const rim = { x: 500, y: 240 };
    const result = detectBodyEntryCompletion(
      makeInput(
        [25, 26, 27],
        [4800, 4700, 4600],
        [0.2, 0.22, 0.24],
        [rim, rim, rim],
        27,
      ),
    );
    expect(result.completionEstablished).toBe(false);
    expect(result.possibleEntryEvidence).toBe(false);
  });

  it('detects genuine Path A completion with temporal support', () => {
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
    expect(result.completionEstablished).toBe(true);
    expect(result.completionPath).toBe('centroid_pixel');
    expect(result.completionTemporalSupportFrames).toBeGreaterThanOrEqual(2);
    expect(result.completionFrameIndex).toBe(31);
  });

  it('rejects nose poke without approach proximity or area reduction', () => {
    const metrics = buildBodyEntryFrameMetrics(
      makeInput([5], [5000], [0.2], [{ x: 480, y: 240 }], 5),
    );
    expect(metrics[0]!.meetsTorsoProximity).toBe(false);
    expect(metrics[0]!.meetsApproachProximity).toBe(false);
    expect(metrics[0]!.meetsBodyEntry).toBe(false);
  });

  it('rejects nose poke with darkening only (no platform shrinkage)', () => {
    const nearNose = { x: 510, y: 240 };
    const result = detectBodyEntryCompletion(
      makeInput(
        [8, 9],
        [5200, 5100],
        [0.25, 0.28],
        [nearNose, nearNose],
        9,
      ),
    );
    expect(result.completionEstablished).toBe(false);
    expect(result.possibleEntryEvidence).toBe(false);
  });

  it('allows Path A completion at recording boundary when temporally supported', () => {
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
    expect(result.completionEstablished).toBe(true);
    expect(result.completionFrameIndex).toBe(98);
    expect(result.completionFrameIndex).not.toBe(100);
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
    expect(result.completionEstablished).toBe(false);
    expect(result.failureReason).toBe('no_temporally_supported_body_entry');
  });

  it('rejects occlusion path without temporal progression between frames', () => {
    const lagging = { x: 507, y: 240 };
    const result = detectBodyEntryCompletion(
      makeInput(
        [50, 51],
        [2800, 2800],
        [0.2, 0.2],
        [lagging, lagging],
        51,
      ),
    );
    expect(result.completionEstablished).toBe(false);
    expect(result.possibleEntryEvidence).toBe(false);
  });

  it('classifies escape_entry_uncertain when only occlusion-path evidence exists', () => {
    const observations: Observation[] = [];
    for (let i = 0; i < 80; i += 1) {
      observations.push(obs(i, 5_000_000 + i * 100_000, { x: 507, y: 240 }));
    }
    const ts = observations.map((o) => ({ timeUs: o.timeUs, frameIndex: o.frameIndex }));
    const bodyEntry = detectBodyEntryCompletion(
      makeInput(
        [60, 61, 62],
        [5000, 2900, 2700],
        [0.14, 0.18, 0.22],
        [{ x: 507, y: 240 }, { x: 507, y: 240 }, { x: 507, y: 240 }],
        62,
      ),
    );
    const esc = detectEscapeOutcome(
      observations,
      geometry,
      trialWindow,
      ts,
      params,
      {
        pixelEvidence: {
          framesAnalyzed: 50,
          framesRequested: 50,
          complete: true,
          areaDecayScore: 0.5,
          holeDarkeningScore: 0.3,
          bodyEntry: bodyEntryFromResult(bodyEntry),
        },
      },
    );
    expect(esc?.type).toBe('escape_entry_uncertain');
    expect(esc?.completionTimeUs).toBeNull();
    expect(esc?.evidence.body_entry_uncertain).toBe(true);
    expect(esc?.evidence.candidate_hole_entry_not_protocol_escape).toBeTruthy();
  });

  it('does not classify escape_completed from aggregate decay alone', () => {
    const observations: Observation[] = [];
    for (let i = 0; i < 80; i += 1) {
      observations.push(obs(i, 5_000_000 + i * 100_000, { x: hole.x - 2, y: hole.y }));
    }
    const ts = observations.map((o) => ({ timeUs: o.timeUs, frameIndex: o.frameIndex }));
    const esc = detectEscapeOutcome(
      observations,
      geometry,
      trialWindow,
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
            completionEstablished: false,
            completionFrameIndex: null,
            completionTimeUs: null,
            completionTemporalSupportFrames: 0,
            completionPath: null,
            possibleEntryEvidence: false,
            possibleEntryFrameIndex: null,
            possibleEntryTimeUs: null,
            possibleEntryTemporalSupportFrames: 0,
            established: false,
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

  it('classifies proposed escape_completed only when Path A completion is established', () => {
    const observations: Observation[] = [];
    for (let i = 0; i < 120; i += 1) {
      observations.push(obs(i, 5_000_000 + i * 100_000, { x: 519, y: 240 }));
    }
    const ts = observations.map((o) => ({ timeUs: o.timeUs, frameIndex: o.frameIndex }));
    const esc = detectEscapeOutcome(
      observations,
      geometry,
      { ...trialWindow, endTimeUs: 17_000_000, proposedEndTimeUs: 17_000_000 },
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
            completionEstablished: true,
            completionFrameIndex: 90,
            completionTimeUs: 14_000_000,
            completionTemporalSupportFrames: 3,
            completionPath: 'centroid_pixel',
            possibleEntryEvidence: false,
            possibleEntryFrameIndex: null,
            possibleEntryTimeUs: null,
            possibleEntryTemporalSupportFrames: 0,
            established: true,
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
    expect(esc?.status).toBe('proposed');
    expect(esc?.completionTimeUs).toBe(14_000_000);
    expect(esc?.completionTimeUs).not.toBe(esc?.censorBoundaryTimeUs);
    expect(esc?.evidence.auto_completion_path).toBe('centroid_pixel');
  });
});
