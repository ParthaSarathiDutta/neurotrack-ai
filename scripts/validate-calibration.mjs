#!/usr/bin/env node
/**
 * Vitest-style calibration check against local sample videos (frame 0).
 * Run: npx tsx scripts/calibration-diagnostic.mjs
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

function extractFrame(videoName) {
  const videoPath = join(DATA, `${videoName}.mp4`);
  const rawPath = join(DATA, `.validate-${videoName}.raw`);
  execSync(
    `ffmpeg -y -loglevel error -i "${videoPath}" -vframes 1 -f rawvideo -pix_fmt rgba "${rawPath}"`,
    { stdio: 'pipe' },
  );
  const buf = readFileSync(rawPath);
  unlinkSync(rawPath);
  return { pixels: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength), width: 640, height: 480 };
}

const failures = [];
const results = {};

for (const name of ['test50', 'test51', 'test53']) {
  const { pixels, width, height } = extractFrame(name);
  const r = detectMazeFromFrames([pixels], width, height);
  const det = r.geometry.detection;
  results[name] = {
    confidence: r.confidence,
    detected: det?.detectedHoleCount,
    modeled: det?.modeledHoleCount,
    maxSlot: det?.ringFitResidualPx,
    medianSlot: det?.medianSlotResidualPx,
    circleFit: det?.circleFitResidualPx,
    center: r.geometry.platformCenter,
  };

  if ((r.geometry.holes?.length ?? 0) !== 20) {
    failures.push(`${name}: expected 20 holes, got ${r.geometry.holes?.length ?? 0}`);
  }
  if ((det?.detectedHoleCount ?? 0) < 18) {
    failures.push(`${name}: too few detected holes (${det?.detectedHoleCount})`);
  }
  if ((det?.ringFitResidualPx ?? 999) > 8) {
    failures.push(`${name}: max slot residual ${det?.ringFitResidualPx?.toFixed(1)} px > 8 px`);
  }
  if (name === 'test51') {
    const c = r.geometry.platformCenter;
    if (!c || Math.hypot(c.x - 284, c.y - 244) > 5) {
      failures.push(`${name}: ring center ${c?.x?.toFixed(1)},${c?.y?.toFixed(1)} far from expected ~(284,244)`);
    }
    if (r.confidence === 'failed') {
      failures.push(`${name}: confidence should not be failed after fix`);
    }
  }
  if (name !== 'test51' && r.confidence !== 'high') {
    failures.push(`${name}: expected high confidence, got ${r.confidence}`);
  }
}

console.log(JSON.stringify(results, null, 2));
if (failures.length) {
  console.error('Calibration validation FAIL:', failures);
  process.exit(1);
}
console.log('Calibration validation PASS');
