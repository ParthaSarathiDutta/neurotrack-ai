import { describe, expect, it } from 'vitest';
import { migrateTrialRecord } from '../src/domain/migration';
import { createTrialStub } from '../src/domain/trialFactory';

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
});
