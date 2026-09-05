#!/usr/bin/env node
/**
 * Offline tracking validation — streams frames from ffmpeg, processes incrementally.
 * Run: npm run validate:tracking
 */
import { execSync, spawn } from 'child_process';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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
const { buildTimestampIndex } = await import(
  new URL('../src/domain/timing.ts', import.meta.url).href
);

function ffprobeJson(videoPath) {
  const out = execSync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=nb_frames,r_frame_rate -of json "${videoPath}"`,
    { encoding: 'utf8' },
  );
  return JSON.parse(out).streams[0];
}

function buildIndexFromProbe(stream) {
  const nb = Number(stream.nb_frames);
  const [num, den] = stream.r_frame_rate.split('/').map(Number);
  return buildTimestampIndex(
    Array.from({ length: nb }, (_, i) => ({ cts: i * num, timescale: den })),
  );
}

function extractFrame(videoName, frameIndex) {
  const videoPath = join(DATA, `${videoName}.mp4`);
  const rawPath = join(DATA, `.validate-track-${videoName}-${frameIndex}.raw`);
  execSync(
    `ffmpeg -y -loglevel error -i "${videoPath}" -vf "select=eq(n\\,${frameIndex})" -vframes 1 -f rawvideo -pix_fmt rgba "${rawPath}"`,
    { stdio: 'pipe' },
  );
  const buf = readFileSync(rawPath);
  unlinkSync(rawPath);
  return new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
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

for (const name of ['test53', 'test51', 'test50']) {
  console.log(`Tracking ${name}…`);
  const videoPath = join(DATA, `${name}.mp4`);
  if (!existsSync(videoPath)) {
    failures.push(`${name}: missing video`);
    continue;
  }

  const probe = ffprobeJson(videoPath);
  const timestampIndex = buildIndexFromProbe(probe);

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
  const startTimeUs = 5_000_000;
  const endTimeUs = timestampIndex[timestampIndex.length - 1].timeUs;
  const trialWindow = {
    startTimeUs,
    endTimeUs,
    cutoffSeconds: 180,
    source: 'auto',
    proposedStartTimeUs: startTimeUs,
    proposedEndTimeUs: endTimeUs,
    confirmedAt: new Date().toISOString(),
    motionOnsetConfidence: 1,
    detectionFailureReason: null,
  };

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
  results[name] = {
    totalFrames: quality.totalFrames,
    trackedFraction: Number(quality.trackedFraction.toFixed(4)),
    lostFraction: Number(quality.lostFraction.toFixed(4)),
    absentInHole: quality.absentInHoleCount,
    assessment: quality.overallAssessment,
    speedOutlierRate: quality.trackedCount
      ? Number((quality.speedOutlierCount / quality.trackedCount).toFixed(4))
      : 0,
    meanConfidence: Number(quality.meanConfidence.toFixed(3)),
  };

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
