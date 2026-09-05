#!/usr/bin/env node
/** Diagnose motion onset detection on sample videos. */
import { execSync } from 'child_process';
import { readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data', 'barnes-maze');

const { detectMazeFromFrames } = await import(
  pathToFileURL(join(ROOT, 'src/domain/calibration/detectMaze.ts')).href
);
const { computeFrameDiffsInMask, detectMotionOnset, sampleFrameIndices } = await import(
  pathToFileURL(join(ROOT, 'src/domain/trialWindow/motionOnset.ts')).href
);

function probeDuration(videoPath) {
  const out = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
    { encoding: 'utf8' },
  ).trim();
  return parseFloat(out);
}

function extractFrameAtSec(videoPath, sec, w, h) {
  const rawPath = join(DATA, `.tw-${sec}.raw`);
  execSync(
    `ffmpeg -y -loglevel error -ss ${sec} -i "${videoPath}" -vframes 1 -f rawvideo -pix_fmt rgba "${rawPath}"`,
    { stdio: 'pipe' },
  );
  const buf = readFileSync(rawPath);
  unlinkSync(rawPath);
  return new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
}

function extractFramesInRange(videoPath, startSec, endSec, count, w, h) {
  const frames = [];
  for (let i = 0; i < count; i += 1) {
    const sec = startSec + (i / (count - 1)) * (endSec - startSec);
    frames.push(extractFrameAtSec(videoPath, sec, w, h));
  }
  return frames;
}

const GEOMETRY = {
  test50: { center: { x: 328.6, y: 242.0 }, radius: 204 },
  test51: { center: { x: 284.2, y: 244.3 }, radius: 218 },
  test53: { center: { x: 328.5, y: 241.5 }, radius: 204 },
};

const w = 640;
const h = 480;

for (const name of ['test50', 'test51', 'test53']) {
  const videoPath = join(DATA, `${name}.mp4`);
  const geo = GEOMETRY[name];
  const frames = extractFramesInRange(videoPath, 3, 7, 41, w, h);
  const diffs = computeFrameDiffsInMask(frames, w, h, geo.center, geo.radius);
  const index = frames.map((_, i) => ({ timeUs: Math.round((3 + (i / 40) * 4) * 1_000_000) }));
  const onset = detectMotionOnset(diffs, index);

  const maxDiff = Math.max(...diffs);
  const noise = diffs.slice(0, 30).sort((a, b) => a - b);
  const floor = noise[Math.floor(noise.length / 2)] ?? 0;
  const threshold = floor * 3 + 1;

  console.log(`\n=== ${name} ===`);
  console.log(`duration=${probeDuration(videoPath).toFixed(1)}s`);
  console.log(`noiseFloor=${floor.toFixed(0)} threshold=${threshold.toFixed(0)} maxDiff=${maxDiff.toFixed(0)}`);
  console.log(`onset=${onset ? `${(onset.startTimeUs / 1e6).toFixed(3)}s conf=${onset.confidence.toFixed(3)}` : 'NULL'}`);

  // Show diffs around 5s (index ~20 of 40 frames from 3-7s)
  const around5 = diffs.map((d, i) => ({ t: 3 + ((i + 1) / 40) * 4, d })).filter((x) => x.t >= 4.5 && x.t <= 5.5);
  console.log('diffs 4.5-5.5s:', around5.map((x) => `${x.t.toFixed(2)}:${x.d.toFixed(0)}`).join(' '));
}

// Compare raw sum vs normalized (per pixel) for test53 at onset
console.log('\n=== test53 metric comparison ===');
const videoPath = join(DATA, 'test53.mp4');
const geo = GEOMETRY.test53;
const frames = extractFramesInRange(videoPath, 3, 7, 41, w, h);
const r2 = geo.radius * geo.radius;
const pixelCount = (() => {
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - geo.center.x, dy = y - geo.center.y;
    if (dx * dx + dy * dy <= r2) n++;
  }
  return n;
})();

const rawDiffs = computeFrameDiffsInMask(frames, w, h, geo.center, geo.radius);
const normDiffs = rawDiffs.map((d) => d / pixelCount);

// max pixel diff per frame pair
const maxDiffs = [];
for (let f = 1; f < frames.length; f++) {
  let max = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - geo.center.x, dy = y - geo.center.y;
    if (dx * dx + dy * dy > r2) continue;
    const idx = (y * w + x) * 4;
    max = Math.max(max, Math.abs(frames[f][idx] - frames[f - 1][idx]));
  }
  maxDiffs.push(max);
}

const index = frames.map((_, i) => ({ timeUs: Math.round((3 + (i / 40) * 4) * 1_000_000) }));
console.log('raw onset:', detectMotionOnset(rawDiffs, index));
console.log('norm onset:', detectMotionOnset(normDiffs, index));
console.log('maxPx onset:', detectMotionOnset(maxDiffs, index));

const around5idx = rawDiffs.map((d, i) => i).filter((i) => {
  const t = 3 + ((i + 1) / 40) * 4;
  return t >= 4.8 && t <= 5.2;
});
for (const i of around5idx) {
  const t = 3 + ((i + 1) / 40) * 4;
  console.log(`t=${t.toFixed(2)} raw=${rawDiffs[i].toFixed(0)} norm=${normDiffs[i].toFixed(2)} maxPx=${maxDiffs[i]}`);
}
