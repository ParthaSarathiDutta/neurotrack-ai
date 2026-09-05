#!/usr/bin/env node
/**
 * Offline calibration diagnostic — extracts frame 0 and runs detectMazeFromFrames.
 * Usage: npx tsx scripts/calibration-diagnostic.mjs
 */
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

function probeSize(videoPath) {
  const out = execSync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "${videoPath}"`,
    { encoding: 'utf8' },
  ).trim();
  const [w, h] = out.split('x').map(Number);
  return { width: w, height: h };
}

function extractFrame0(videoPath, rawPath) {
  execSync(
    `ffmpeg -y -loglevel error -i "${videoPath}" -vframes 1 -f rawvideo -pix_fmt rgba "${rawPath}"`,
    { stdio: 'pipe' },
  );
  const buf = readFileSync(rawPath);
  return new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
}

function holeStats(result) {
  const holes = result.geometry.holes ?? [];
  const detected = holes.filter((h) => h.source === 'detected');
  const modeled = holes.filter((h) => h.source === 'model');
  const center = result.geometry.platformCenter;
  const det = result.geometry.detection;

  return {
    success: result.success,
    confidence: result.confidence,
    error: result.error,
    roughCenter: result.roughCenter,
    ringCenter: center,
    maxSlotResidualPx: det?.ringFitResidualPx,
    medianSlotResidualPx: det?.medianSlotResidualPx,
    circleFitResidualPx: det?.circleFitResidualPx,
    candidates: det?.holeCandidateCount,
    detected: detected.length,
    modeled: modeled.length,
  };
}

const summary = {};
for (const name of ['test50', 'test51', 'test53']) {
  const videoPath = join(DATA, `${name}.mp4`);
  const { width, height } = probeSize(videoPath);
  const rawPath = join(DATA, `.diag-${name}.raw`);
  const pixels = extractFrame0(videoPath, rawPath);
  unlinkSync(rawPath);

  const result = detectMazeFromFrames([pixels], width, height);
  summary[name] = holeStats(result);
  console.log(`\n=== ${name} (${width}x${height}) ===`);
  console.log(JSON.stringify(summary[name], null, 2));
}

console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));
