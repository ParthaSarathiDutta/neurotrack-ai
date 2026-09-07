#!/usr/bin/env node
/**
 * Offline MS-5 summary: track + detect events + measures per clip.
 * Target hole 0 confirmed for offline diagnostic only (not validation pass/fail).
 */
import { readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import { extractMp4TimestampIndex } from './lib/mp4TimestampIndex.mjs';
import { proposeTrialWindowOffline } from './lib/offlineTrialWindow.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data', 'barnes-maze');
const CLIPS = process.env.CLIPS ? process.env.CLIPS.split(',') : ['test53', 'test51', 'test50'];
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
  createInitialTrackerState,
  processTrackingFrame,
} = await import(new URL('../src/domain/tracking/trackPipeline.ts', import.meta.url).href);
const { defaultTrackingParams, defaultEventDetectionParams, defaultOperationalDefinitions } =
  await import(new URL('../src/domain/trialFactory.ts', import.meta.url).href);
const { detectEvents } = await import(
  new URL('../src/domain/events/detectEvents.ts', import.meta.url).href
);
const { computeMeasures } = await import(
  new URL('../src/domain/measures/computeMeasures.ts', import.meta.url).href
);

function extractFrame(videoName, frameIndex) {
  const videoPath = join(DATA, `${videoName}.mp4`);
  const rawPath = join(DATA, `.validate-events-${videoName}-${frameIndex}.raw`);
  execSync(
    `ffmpeg -y -loglevel error -i "${videoPath}" -vf "select=eq(n\\,${frameIndex})" -vframes 1 -f rawvideo -pix_fmt rgba "${rawPath}"`,
    { stdio: 'pipe' },
  );
  const buf = readFileSync(rawPath);
  unlinkSync(rawPath);
  return new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function trackVideo(name, ctx, timestampIndex) {
  const videoPath = join(DATA, `${name}.mp4`);
  return new Promise((resolve, reject) => {
    const observations = [];
    let state = createInitialTrackerState();
    let frameIdx = 0;
    let pending = Buffer.alloc(0);
    const proc = spawn('ffmpeg', ['-loglevel', 'error', '-i', videoPath, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
    proc.stdout.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= FRAME_BYTES && frameIdx < timestampIndex.length) {
        const slice = pending.subarray(0, FRAME_BYTES);
        pending = pending.subarray(FRAME_BYTES);
        const frame = new Uint8ClampedArray(slice.buffer, slice.byteOffset, FRAME_BYTES);
        const entry = timestampIndex[frameIdx];
        const prev = frameIdx > 0 ? timestampIndex[frameIdx - 1] : null;
        const result = processTrackingFrame(ctx, state, frame, entry, prev);
        observations.push(result.observation);
        state = result.state;
        frameIdx += 1;
      }
    });
    proc.on('close', (code) => (code === 0 ? resolve(observations) : reject(new Error(`ffmpeg ${code}`))));
    proc.on('error', reject);
  });
}

const out = {};

for (const name of CLIPS) {
  console.error(`Events offline: ${name}…`);
  const videoPath = join(DATA, `${name}.mp4`);
  const timestampIndex = await extractMp4TimestampIndex(videoPath);

  const det = detectMazeFromFrames([extractFrame(name, 0)], WIDTH, HEIGHT);
  const geometry = {
    ...det.geometry,
    platformCenter: det.geometry.platformCenter ?? det.roughCenter,
    platformRadiusPx: det.geometry.platformRadiusPx ?? det.roughRadius,
    targetHoleId: 0,
    targetHoleConfirmedAt: 'offline-diagnostic-only',
    confirmedAt: 'offline',
    source: 'auto',
  };

  const windowProposal = proposeTrialWindowOffline({
    timestampIndex,
    geometry,
    width: WIDTH,
    height: HEIGHT,
    getFramePixels: (idx) => extractFrame(name, idx),
  });
  const startTimeUs = windowProposal.startTimeUs ?? 5_000_000;
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
    detectionFailureReason: windowProposal.failureReason ?? null,
  };

  const params = defaultTrackingParams();
  const bgIndices = sampleBackgroundFrameIndices(
    timestampIndex,
    startTimeUs,
    endTimeUs,
    params.backgroundSampleCount,
  );
  const bgFrames = bgIndices.map((i) => extractFrame(name, i));
  const background = buildBackgroundModel(bgFrames, WIDTH, HEIGHT);
  const ctx = buildTrackingFrameContext(WIDTH, HEIGHT, background, geometry, trialWindow, params);
  const observations = await trackVideo(name, ctx, timestampIndex);

  const eventParams = defaultEventDetectionParams();
  const analysis = detectEvents({
    observations,
    geometry,
    trialWindow,
    timestampIndex,
    params: eventParams,
    operationalDefinitions: defaultOperationalDefinitions(),
    basisUsed: 'corrected',
  });

  const measures = computeMeasures(
    observations,
    analysis.events,
    geometry,
    trialWindow,
    timestampIndex,
    eventParams,
    defaultOperationalDefinitions(),
    'corrected',
  );

  const escape = analysis.events.find((e) => e.type !== 'investigation');
  const invEvents = analysis.events.filter((e) => e.type === 'investigation');
  const dwells = invEvents.map((e) => Number(e.evidence.dwellUs ?? 0) / 1_000_000);
  const distinctHoles = new Set(invEvents.map((e) => e.holeId)).size;
  out[name] = {
    investigations: invEvents.length,
    distinctHolesVisited: distinctHoles,
    medianDwellSec: dwells.length
      ? dwells.slice().sort((a, b) => a - b)[Math.floor(dwells.length / 2)]
      : null,
    escapeType: escape?.type ?? null,
    totalLatencyCensored: measures?.totalLatency.censored ?? null,
    totalLatencyLowerBoundSec: measures?.totalLatency.lowerBound ?? null,
    primaryErrorsConfirmed: measures?.primaryErrors.value ?? null,
    strategy: measures?.searchStrategy.classification ?? null,
    note: 'target hole 0 confirmed offline for diagnostic only',
  };
}

console.log(JSON.stringify(out, null, 2));
