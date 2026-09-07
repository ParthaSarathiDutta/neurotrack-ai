import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSessionForTests,
  defaultAnalysisParams,
  loadSession,
  saveSession,
} from '../src/db/database';
import { mergeDetectedEvents } from '../src/domain/events/eventMerge';
import {
  applyManualCorrections,
  canRemoveNoseEstimate,
  effectiveNoseXY,
  removeManualCorrection,
  resolveNoseRemoval,
  upsertManualCorrection,
} from '../src/domain/trajectory/manualCorrection';
import {
  markAppliedCleaningStale,
  STALE_REASON_MANUAL_CORRECTION,
} from '../src/domain/trajectory/cleaningStaleness';
import { resolveEffectiveObservations } from '../src/domain/trajectory/resolveObservations';
import type { BehavioralEvent, ManualCorrection, Observation, Track } from '../src/domain/types';
import { applyIngestResult, createTrialStub, defaultCleaningParams, defaultTrackingParams } from '../src/domain/trialFactory';

function obs(
  frameIndex: number,
  timeUs: number,
  body: { x: number; y: number } | null,
  nose: { x: number; y: number } | null = null,
): Observation {
  return {
    frameIndex,
    timeUs,
    bodyXY: body,
    noseXY: nose,
    confidence: body ? 0.8 : 0,
    observed: body ? 'tracked' : 'lost',
    origin: 'auto',
    qualityFlags: null,
  };
}

function trackWith(
  observations: Observation[],
  manualCorrections: ManualCorrection[] = [],
  appliedStale = false,
): Track {
  return {
    status: 'done',
    observations,
    manualCorrections,
    appliedCleaning: appliedStale
      ? {
          observations: [],
          params: defaultCleaningParams(),
          appliedAt: 't',
          stale: false,
          staleReason: null,
        }
      : null,
    quality: null,
    params: defaultTrackingParams(),
    computedAt: null,
    error: null,
  };
}

describe('one-click nose removal', () => {
  const timeUs = 1_000_000;
  const frameIndex = 5;
  const autoBody = { x: 100, y: 200 };
  const autoNose = { x: 110, y: 190 };
  const manualBody = { x: 120, y: 210 };
  const manualNose = { x: 125, y: 205 };

  it('removes automatic nose in one click without an existing manual correction', () => {
    const raw = obs(frameIndex, timeUs, autoBody, autoNose);
    const outcome = resolveNoseRemoval(frameIndex, timeUs, raw, undefined, 't1');
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;

    expect(outcome.correction.bodyXY).toEqual(autoBody);
    expect(outcome.correction.noseXY).toBeNull();

    const effective = applyManualCorrections([raw], [outcome.correction]);
    expect(raw.noseXY).toEqual(autoNose);
    expect(effective[0].noseXY).toBeNull();
    expect(effective[0].bodyXY).toEqual(autoBody);
    expect(effective[0].origin).toBe('manual');
  });

  it('reports no body when automatic nose exists but body is missing', () => {
    const raw = obs(frameIndex, timeUs, null, autoNose);
    expect(resolveNoseRemoval(frameIndex, timeUs, raw, undefined, 't').kind).toBe('no_body');
  });

  it('removes a manual nose correction while preserving the corrected body', () => {
    const raw = obs(frameIndex, timeUs, autoBody, autoNose);
    const existing: ManualCorrection = {
      frameIndex,
      timeUs,
      bodyXY: manualBody,
      noseXY: manualNose,
      correctedAt: 'before',
    };
    const outcome = resolveNoseRemoval(frameIndex, timeUs, raw, existing, 't3');
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;

    expect(outcome.correction.bodyXY).toEqual(manualBody);
    expect(outcome.correction.noseXY).toBeNull();

    const effective = applyManualCorrections([raw], [outcome.correction]);
    expect(effective[0].bodyXY).toEqual(manualBody);
    expect(effective[0].noseXY).toBeNull();
  });

  it('reports clear feedback when there is no nose to remove', () => {
    const raw = obs(frameIndex, timeUs, autoBody, null);
    expect(resolveNoseRemoval(frameIndex, timeUs, raw, undefined, 't').kind).toBe('no_nose');
    expect(canRemoveNoseEstimate(raw, undefined)).toBe(false);
  });

  it('reports already removed when nose was previously marked unavailable', () => {
    const raw = obs(frameIndex, timeUs, autoBody, autoNose);
    const existing: ManualCorrection = {
      frameIndex,
      timeUs,
      bodyXY: autoBody,
      noseXY: null,
      correctedAt: 't',
    };
    expect(effectiveNoseXY(raw, existing)).toBeNull();
    expect(canRemoveNoseEstimate(raw, existing)).toBe(false);
    expect(resolveNoseRemoval(frameIndex, timeUs, raw, existing, 't').kind).toBe('already_removed');
  });

  it('reset frame to auto restores the original automatic nose', () => {
    const raw = obs(frameIndex, timeUs, autoBody, autoNose);
    const removal = resolveNoseRemoval(frameIndex, timeUs, raw, undefined, 't');
    expect(removal.kind).toBe('ok');
    if (removal.kind !== 'ok') return;

    const corrected = applyManualCorrections([raw], [removal.correction]);
    expect(corrected[0].noseXY).toBeNull();

    const afterReset = applyManualCorrections(
      [raw],
      removeManualCorrection([removal.correction], frameIndex),
    );
    expect(afterReset[0].origin).toBe('auto');
    expect(afterReset[0].noseXY).toEqual(autoNose);
    expect(raw.noseXY).toEqual(autoNose);
  });

  it('marks applied cleaning stale when a nose removal correction is upserted', () => {
    const raw = obs(frameIndex, timeUs, autoBody, autoNose);
    const removal = resolveNoseRemoval(frameIndex, timeUs, raw, undefined, 't');
    expect(removal.kind).toBe('ok');
    if (removal.kind !== 'ok') return;

    const base = trackWith([raw], [], true);
    const updated = markAppliedCleaningStale(
      {
        ...base,
        manualCorrections: upsertManualCorrection(base.manualCorrections, removal.correction),
      },
      STALE_REASON_MANUAL_CORRECTION,
    );
    expect(updated.appliedCleaning?.stale).toBe(true);
    expect(updated.appliedCleaning?.staleReason).toBe(STALE_REASON_MANUAL_CORRECTION);
  });

  it('preserves confirmed reviewed events during merge after correction-driven redetect', () => {
    const confirmed: BehavioralEvent = {
      id: 'confirmed-inv',
      type: 'investigation',
      holeId: 2,
      startFrameIndex: frameIndex,
      endFrameIndex: frameIndex + 5,
      startTimeUs: timeUs,
      endTimeUs: timeUs + 500_000,
      entryOnsetTimeUs: timeUs,
      completionTimeUs: null,
      censorBoundaryTimeUs: null,
      origin: 'auto',
      status: 'confirmed',
      confidence: 'high',
      visitIndex: 1,
      isRevisit: false,
      evidence: {},
      notes: null,
    };
    const redetected: BehavioralEvent = {
      ...confirmed,
      id: 'new-auto',
      status: 'proposed',
      origin: 'auto',
    };
    const merged = mergeDetectedEvents([confirmed], [redetected]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('confirmed-inv');
    expect(merged[0]?.status).toBe('confirmed');
  });
});

describe('one-click nose removal persistence', () => {
  beforeEach(async () => {
    await clearSessionForTests();
  });

  it('round-trips nose removal corrections through session persistence', async () => {
    const frameIndex = 3;
    const timeUs = 900_000;
    const raw = obs(frameIndex, timeUs, { x: 50, y: 60 }, { x: 55, y: 58 });
    const removal = resolveNoseRemoval(frameIndex, timeUs, raw, undefined, 'persist-t');
    expect(removal.kind).toBe('ok');
    if (removal.kind !== 'ok') return;

    const trial = applyIngestResult(createTrialStub('persist-fp', 'test51.mp4'), null, [], 100);
    trial.track = trackWith([raw], [removal.correction]);

    await saveSession({
      trials: [trial],
      selectedTrialId: trial.id,
      analysisParams: defaultAnalysisParams(),
    });

    const loaded = await loadSession();
    const loadedCorrection = loaded?.trials[0]?.track?.manualCorrections[0];
    expect(loadedCorrection?.noseXY).toBeNull();
    expect(loadedCorrection?.bodyXY).toEqual({ x: 50, y: 60 });

    const effective = resolveEffectiveObservations(loaded!.trials[0].track!, {});
    const frame = effective.find((o) => o.frameIndex === frameIndex);
    expect(frame?.noseXY).toBeNull();
    expect(frame?.bodyXY).toEqual({ x: 50, y: 60 });
    expect(loaded!.trials[0].track!.observations[0].noseXY).toEqual({ x: 55, y: 58 });
  });
});
