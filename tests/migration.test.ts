import { describe, expect, it } from 'vitest';
import { migrateTrialRecord } from '../src/domain/migration';
import { createTrialStub } from '../src/domain/trialFactory';
import type { Track } from '../src/domain/types';

describe('migration', () => {
  it('adds MS-2 fields to MS-1 trial records', () => {
    const stub = createTrialStub('abc', 'video.mp4');
    const migrated = migrateTrialRecord(stub);
    expect(migrated.geometry.proposedTargetHoleId).toBeNull();
    expect(migrated.geometry.targetHoleConfirmedAt).toBeNull();
    expect(migrated.trialWindow.proposedStartTimeUs).toBeNull();
    expect(migrated.trialWindow.confirmedAt).toBeNull();
    expect(migrated.track).toBeNull();
  });

  it('adds MS-4 track correction fields', () => {
    const stub = createTrialStub('abc', 'video.mp4');
    const migrated = migrateTrialRecord({
      ...stub,
      track: {
        status: 'done',
        observations: [],
        quality: null,
        params: {
          backgroundSampleCount: 30,
          minBlobAreaFraction: 0,
          maxBlobAreaFraction: 1,
          maxPlausibleSpeedPxPerSec: 800,
          lowConfidenceThreshold: 0.45,
          toolVersion: 'x',
        },
        computedAt: null,
        error: null,
      } as Track,
    });
    expect(migrated.track?.manualCorrections).toEqual([]);
    expect(migrated.track?.appliedCleaning).toBeNull();
  });
});
