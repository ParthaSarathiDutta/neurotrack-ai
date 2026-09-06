#!/usr/bin/env node
/**
 * Offline tracking validation — streams frames from ffmpeg, processes incrementally.
 * Uses container-derived timestamps (mp4box) and motion-onset trial window (same as live UI).
 * Run: npm run validate:tracking
 */
import { execSync, spawn } from 'child_process';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extractMp4TimestampIndex } from './lib/mp4TimestampIndex.mjs';
import { proposeTrialWindowOffline } from './lib/offlineTrialWindow.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data', 'barnes-maze');
const WIDTH = 640;
const HEIGHT = 480;
const FRAME_BYTES = WIDTH * HEIGHT * 4;

const { detectMazeFromFrames } = await import(
  new URL('../src/domain/calibration/detectMaze.ts', import.meta.url).href
);
const { buildBackgroundModel, sampleBackgroundFrameIndices } = await import(
  new URL('../src/domain/tracking/background.ts', import.meta.url).href
);
const {
  buildTrackingFrameContext,
  computeTrackQuality,
  createInitialTrackerState,
  processTrackingFrame,
} = await import(new URL('../src/domain/tracking/trackPipeline.ts', import.meta.url).href);
const { defaultTrackingParams } = await import(
  new URL('../src/domain/trialFactory.ts', import.meta.url).href
);

const frameCache = new Map();

function extractFrame(videoName, frameIndex) {
  const key = `${videoName}:${frameIndex}`;
  if (frameCache.has(key)) return frameCache.get(key);

  const videoPath = join(DATA, `${videoName}.mp4`);
  const rawPath = join(DATA, `.validate-track-${videoName}-${frameIndex}.raw`);
  execSync(
    `ffmpeg -y -loglevel error -i "${videoPath}" -vf "select=eq(n\\,${frameIndex})" -vframes 1 -f rawvideo -pix_fmt rgba "${rawPath}"`,
    { stdio: 'pipe' },
  );
  const buf = readFileSync(rawPath);
  unlinkSync(rawPath);
  const pixels = new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
  frameCache.set(key, pixels);
  return pixels;
}

function trackVideoStreaming(videoName, ctx, timestampIndex) {
  const videoPath = join(DATA, `${videoName}.mp4`);
  return new Promise((resolve, reject) => {
    const observations = [];
    let state = createInitialTrackerState();
    let frameIdx = 0;
    let pending = Buffer.alloc(0);

    const proc = spawn('ffmpeg', [
      '-loglevel',
      'error',
      '-i',
      videoPath,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      'pipe:1',
    ]);

    proc.stdout.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= FRAME_BYTES && frameIdx < timestampIndex.length) {
        const slice = pending.subarray(0, FRAME_BYTES);
        pending = pending.subarray(FRAME_BYTES);
        const frame = new Uint8ClampedArray(
          slice.buffer.slice(slice.byteOffset, slice.byteOffset + FRAME_BYTES),
        );
        const entry = timestampIndex[frameIdx];
        const prev = frameIdx > 0 ? timestampIndex[frameIdx - 1] : null;
        const result = processTrackingFrame(ctx, state, frame, entry, prev);
        observations.push(result.observation);
        state = result.state;
        frameIdx += 1;
        if (frameIdx % 500 === 0) {
          console.log(`  ${videoName}: ${frameIdx}/${timestampIndex.length} frames`);
        }
      }
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exit ${code} for ${videoName}`));
        return;
      }
      if (observations.length !== timestampIndex.length) {
        reject(
          new Error(
            `${videoName}: processed ${observations.length} != ${timestampIndex.length} frames`,
          ),
        );
        return;
      }
      resolve(observations);
    });
  });
}

const failures = [];
const results = {};
const params = defaultTrackingParams();

/** Manual review spot-checks from MS-3 follow-up (1-based frame numbers → 0-based index). */
const MANUAL_SPOT_CHECKS = {
  test51: {
    mustTrack: [180, 269, 333, 671, 680],
  },
  test50: {
    mustTrack: [572, 585, 591, 2046, 2050],
    mustNotAbsentInHole: [572, 585, 591, 2046, 2050],
  },
};

for (const name of ['test53', 'test51', 'test50']) {
  console.log(`Tracking ${name}…`);
  frameCache.clear();
  const videoPath = join(DATA, `${name}.mp4`);
  if (!existsSync(videoPath)) {
    failures.push(`${name}: missing video`);
    continue;
  }

  const timestampIndex = await extractMp4TimestampIndex(videoPath);

  const det = detectMazeFromFrames([extractFrame(name, 0)], WIDTH, HEIGHT);
  if ((det.geometry.holes?.length ?? 0) !== 20) {
    failures.push(`${name}: calibration failed`);
    continue;
  }

  const geometry = {
    ...det.geometry,
    platformCenter: det.geometry.platformCenter ?? det.roughCenter,
    platformRadiusPx: det.geometry.platformRadiusPx ?? det.roughRadius,
    confirmedAt: new Date().toISOString(),
    source: 'auto',
  };
  if (!geometry.platformCenter || !geometry.platformRadiusPx) {
    failures.push(`${name}: incomplete platform geometry`);
    continue;
  }

  const windowProposal = proposeTrialWindowOffline({
    timestampIndex,
    geometry,
    width: WIDTH,
    height: HEIGHT,
    getFramePixels: (idx) => extractFrame(name, idx),
  });

  if (!windowProposal.success || windowProposal.startTimeUs == null) {
    failures.push(
      `${name}: trial window detection failed (${windowProposal.failureReason ?? 'unknown'})`,
    );
    continue;
  }

  const startTimeUs = windowProposal.startTimeUs;
  const endTimeUs = timestampIndex[timestampIndex.length - 1].timeUs;
  const trialWindow = {
    startTimeUs,
    endTimeUs,
    cutoffSeconds: 180,
    source: 'auto',
    proposedStartTimeUs: startTimeUs,
    proposedEndTimeUs: endTimeUs,
    confirmedAt: new Date().toISOString(),
    motionOnsetConfidence: windowProposal.confidence,
    detectionFailureReason: null,
  };

  console.log(
    `  ${name}: trial start ${(startTimeUs / 1e6).toFixed(6)} s (confidence ${windowProposal.confidence?.toFixed(3) ?? '—'})`,
  );

  const bgIndices = sampleBackgroundFrameIndices(
    timestampIndex,
    startTimeUs,
    endTimeUs,
    params.backgroundSampleCount,
  );
  const bgFrames = bgIndices.map((i) => extractFrame(name, i));
  const background = buildBackgroundModel(bgFrames, WIDTH, HEIGHT);
  const ctx = buildTrackingFrameContext(
    WIDTH,
    HEIGHT,
    background,
    geometry,
    trialWindow,
    params,
  );

  let observations;
  try {
    observations = await trackVideoStreaming(name, ctx, timestampIndex);
  } catch (err) {
    failures.push(`${name}: ${err instanceof Error ? err.message : err}`);
    continue;
  }

  const quality = computeTrackQuality(observations, params);
  const trackedObs = observations.filter((o) => o.observed === 'tracked');
  const noseCount = trackedObs.filter((o) => o.bodyXY != null && o.noseXY != null).length;
  const ambiguousHeadTailCount = trackedObs.filter((o) =>
    o.qualityFlags?.includes('ambiguous_head_tail'),
  ).length;
  results[name] = {
    totalFrames: quality.totalFrames,
    trackedFraction: Number(quality.trackedFraction.toFixed(4)),
    lostFraction: Number(quality.lostFraction.toFixed(4)),
    absentInHole: quality.absentInHoleCount,
    assessment: quality.overallAssessment,
    trialStartSec: Number((startTimeUs / 1e6).toFixed(6)),
    motionOnsetConfidence: windowProposal.confidence != null
      ? Number(windowProposal.confidence.toFixed(3))
      : null,
    speedOutlierRate: quality.trackedCount
      ? Number((quality.speedOutlierCount / quality.trackedCount).toFixed(4))
      : 0,
    meanConfidence: Number(quality.meanConfidence.toFixed(3)),
    noseRate: trackedObs.length ? Number((noseCount / trackedObs.length).toFixed(4)) : 0,
    ambiguousHeadTailRate: trackedObs.length
      ? Number((ambiguousHeadTailCount / trackedObs.length).toFixed(4))
      : 0,
  };

  const spot = MANUAL_SPOT_CHECKS[name];
  if (spot) {
    const spotResults = {};
    if (spot.mustTrack) {
      for (const idx of spot.mustTrack) {
        const obs = observations[idx];
        spotResults[`frame_${idx + 1}`] = obs
          ? { observed: obs.observed, hasBody: obs.bodyXY != null }
          : { observed: 'missing', hasBody: false };
        if (!obs || obs.observed !== 'tracked' || obs.bodyXY == null) {
          failures.push(`${name}: manual spot frame ${idx + 1} expected tracked with body`);
        }
      }
    }
    if (spot.mustNotAbsentInHole) {
      for (const idx of spot.mustNotAbsentInHole) {
        const obs = observations[idx];
        if (obs?.observed === 'absent_in_hole') {
          failures.push(`${name}: manual spot frame ${idx + 1} must not be absent_in_hole`);
        }
      }
    }
    results[name].manualSpotChecks = spotResults;
  }

  if (observations.some((o) => o.origin !== 'auto')) failures.push(`${name}: non-auto origin`);
  if (
    observations
      .filter((o) => o.timeUs < startTimeUs)
      .some((o) => o.observed !== 'absent_pre_trial' || o.bodyXY != null)
  ) {
    failures.push(`${name}: pre-trial incorrect`);
  }
  if (quality.trackedFraction < 0.6) {
    failures.push(`${name}: tracked ${quality.trackedFraction.toFixed(3)} < 0.6`);
  }
  if (quality.trackedCount > 0 && quality.speedOutlierCount / quality.trackedCount > 0.05) {
    failures.push(`${name}: speed outliers too high`);
  }
  const preTrialCount = observations.filter((o) => o.observed === 'absent_pre_trial').length;
  if (
    quality.trackedCount + quality.lostCount + quality.absentInHoleCount + preTrialCount !==
    quality.totalFrames
  ) {
    failures.push(`${name}: quality counts inconsistent`);
  }
  if (name === 'test51') {
    const first5s = observations.filter(
      (o) => o.timeUs >= startTimeUs && o.timeUs < startTimeUs + 5_000_000,
    );
    const trackedFirst5 = first5s.filter((o) => o.observed === 'tracked').length;
    if (first5s.length > 0 && trackedFirst5 / first5s.length < 0.5) {
      failures.push(
        `${name}: poor early tracking ${trackedFirst5}/${first5s.length} in first 5s after start`,
      );
    }
  }
}

console.log(JSON.stringify(results, null, 2));
if (failures.length) {
  console.error('Tracking validation FAIL:', failures);
  process.exit(1);
}
console.log('Tracking validation PASS');
