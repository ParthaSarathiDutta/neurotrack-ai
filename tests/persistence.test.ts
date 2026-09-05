import { beforeEach, describe, expect, it } from 'vitest';
import {
  attachCacheFlags,
  clearSessionForTests,
  loadSession,
  saveSession,
  defaultAnalysisParams,
} from '../src/db/database';
import { enforceCacheBudget, putVideoInCache, listCachedFingerprints } from '../src/db/videoCache';
import { applyIngestResult, createTrialStub } from '../src/domain/trialFactory';
import type { VideoMetadata } from '../src/domain/types';

const sampleMetadata: VideoMetadata = {
  codec: 'avc1.640020',
  codedWidth: 640,
  codedHeight: 480,
  trackTimescale: 15000,
  durationSec: 49.38,
  nbSamples: 741,
  decoderOutputFrames: 741,
  containerFrameRateLabel: '15000/1001',
  medianUniqueCtsDelta: 1001,
  frameCountWarning: null,
};

describe('persistence', () => {
  beforeEach(async () => {
    await clearSessionForTests();
  });

  it('round-trips session through Dexie', async () => {
    const trial = applyIngestResult(
      createTrialStub('abc123', 'test51.mp4'),
      sampleMetadata,
      [{ timeUs: 66733, frameIndex: 0, cts: 1001, timescale: 15000 }],
      120,
    );

    await saveSession({
      trials: [trial],
      selectedTrialId: trial.id,
      analysisParams: defaultAnalysisParams(),
    });

    const loaded = await loadSession();
    expect(loaded?.trials).toHaveLength(1);
    expect(loaded?.trials[0].metadata?.containerFrameRateLabel).toBe('15000/1001');
    expect(loaded?.selectedTrialId).toBe(trial.id);
  });

  it('marks trials needs_reselect when blob cache evicted but metadata persists', async () => {
    const trial = applyIngestResult(
      createTrialStub('fp1', 'test50.mp4'),
      { ...sampleMetadata, trackTimescale: 15360, containerFrameRateLabel: '15360/512' },
      [],
      200,
    );

    await saveSession({
      trials: [trial],
      selectedTrialId: trial.id,
      analysisParams: defaultAnalysisParams(),
    });

    const loaded = await loadSession();
    expect(loaded).not.toBeNull();
    const flagged = await attachCacheFlags(loaded!.trials);
    expect(flagged[0].videoCached).toBe(false);
    expect(flagged[0].ingestStatus).toBe('needs_reselect');
    expect(flagged[0].metadata?.nbSamples).toBe(741);
  });

  it('re-associates same fingerprint after cache eviction and re-store', async () => {
    const blob = new Blob(['video-bytes'], { type: 'video/mp4' });
    await putVideoInCache('fp-evict', blob, 'test53.mp4', 10_000);
    expect(await listCachedFingerprints()).toContain('fp-evict');

    const evicted = await enforceCacheBudget(5);
    expect(evicted).toContain('fp-evict');
    expect(await listCachedFingerprints()).toHaveLength(0);

    await putVideoInCache('fp-evict', blob, 'test53.mp4', 10_000);
    expect(await listCachedFingerprints()).toContain('fp-evict');
  });
});
