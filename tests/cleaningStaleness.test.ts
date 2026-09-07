import { describe, expect, it } from 'vitest';
import {
  cleaningParamsMatch,
  isAppliedCleaningConsumable,
  markAppliedCleaningStale,
} from '../src/domain/trajectory/cleaningStaleness';
import { defaultCleaningParams, defaultTrackingParams } from '../src/domain/trialFactory';
import type { Track } from '../src/domain/types';

function trackWithApplied(stale = false): Track {
  return {
    status: 'done',
    observations: [],
    manualCorrections: [],
    appliedCleaning: {
      observations: [],
      params: defaultCleaningParams(),
      appliedAt: 't',
      stale,
      staleReason: stale ? 'stale' : null,
    },
    quality: null,
    params: defaultTrackingParams(),
    computedAt: null,
    error: null,
  };
}

describe('cleaning staleness', () => {
  it('marks applied cleaning stale without deleting snapshot', () => {
    const updated = markAppliedCleaningStale(trackWithApplied(), 'reason');
    expect(updated.appliedCleaning?.stale).toBe(true);
    expect(updated.appliedCleaning?.staleReason).toBe('reason');
  });

  it('consumable only when applied and not stale', () => {
    expect(isAppliedCleaningConsumable(trackWithApplied(false).appliedCleaning)).toBe(false);
    const withObs = {
      ...trackWithApplied(false).appliedCleaning!,
      observations: [
        {
          frameIndex: 0,
          timeUs: 0,
          bodyXY: { x: 1, y: 1 },
          noseXY: null,
          confidence: 1,
          observed: 'tracked' as const,
          origin: 'auto' as const,
          qualityFlags: null,
        },
      ],
    };
    expect(isAppliedCleaningConsumable(withObs)).toBe(true);
    expect(isAppliedCleaningConsumable({ ...withObs, stale: true })).toBe(false);
  });

  it('detects cleaning parameter drift', () => {
    const params = defaultCleaningParams();
    expect(cleaningParamsMatch(params, { ...params })).toBe(true);
    expect(cleaningParamsMatch(params, { ...params, maxGapFrames: params.maxGapFrames + 1 })).toBe(
      false,
    );
  });
});
