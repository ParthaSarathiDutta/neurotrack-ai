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
    expect(migrated.trialWindow.cutoffSeconds).toBeNull();
    expect(migrated.track).toBeNull();
  });

  it('preserves explicitly saved cutoff on migrated sessions', () => {
    const stub = createTrialStub('abc', 'video.mp4');
    const migrated = migrateTrialRecord({
      ...stub,
      trialWindow: { ...stub.trialWindow, cutoffSeconds: 15 },
    });
    expect(migrated.trialWindow.cutoffSeconds).toBe(15);
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

  it('marks stale auto escape when body-entry v3 supersedes v2 occlusion auto-complete', () => {
    const stub = createTrialStub('abc', 'video.mp4');
    const migrated = migrateTrialRecord({
      ...stub,
      events: {
        basisUsed: 'corrected',
        computedAt: 'x',
        stale: false,
        staleReason: null,
        events: [
          {
            id: 'e1',
            type: 'escape_completed',
            holeId: 1,
            startFrameIndex: 0,
            endFrameIndex: 10,
            startTimeUs: 0,
            endTimeUs: 1_000_000,
            entryOnsetTimeUs: 0,
            completionTimeUs: 1_000_000,
            censorBoundaryTimeUs: 2_000_000,
            origin: 'auto',
            status: 'proposed',
            confidence: 'high',
            visitIndex: null,
            isRevisit: null,
            evidence: {
              bodyEntryDefinitionVersion: '2',
              bodyEntryCompletionPath: 'occlusion_pixel',
            },
            notes: null,
          },
        ],
      },
    });
    expect(migrated.events?.stale).toBe(true);
    expect(migrated.events?.staleReason).toMatch(/v3|supersedes|occlusion/i);
  });
});
