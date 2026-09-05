#!/usr/bin/env node
/**
 * Quantitative hole-center accuracy: predicted calibration vs independent dark-hole estimates.
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
const { videoToDisplay, displayToVideo } = await import(
  pathToFileURL(join(ROOT, 'src/domain/videoTransform.ts')).href
);

function extractFrame(name) {
  const rawPath = join(DATA, `.measure-${name}.raw`);
  execSync(
    `ffmpeg -y -loglevel error -i "${join(DATA, `${name}.mp4`)}" -vframes 1 -f rawvideo -pix_fmt rgba "${rawPath}"`,
    { stdio: 'pipe' },
  );
  const buf = readFileSync(rawPath);
  unlinkSync(rawPath);
  return new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
}

function grayAt(frame, width, x, y) {
  return frame[(y * width + x) * 4];
}

/** Independent estimate: darkest-pixel cluster center in local window. */
function darkestClusterCenter(frame, width, height, hint, radius = 14) {
  let minGray = 255;
  const darkPts = [];
  const cx = Math.round(hint.x);
  const cy = Math.round(hint.y);
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (Math.hypot(dx, dy) > radius) continue;
      const g = grayAt(frame, width, x, y);
      if (g <= minGray + 8) {
        if (g < minGray) {
          minGray = g;
          darkPts.length = 0;
        }
        darkPts.push({ x, y, g });
      }
    }
  }
  if (darkPts.length === 0) return hint;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (const p of darkPts) {
    const w = 255 - p.g;
    sx += p.x * w;
    sy += p.y * w;
    sw += w;
  }
  return { x: sx / sw, y: sy / sw };
}

/** Independent estimate: radial dark-aperture center from platform center. */
function radialApertureCenter(frame, width, height, platformCenter, hint, searchRadius = 16) {
  const angle = Math.atan2(hint.y - platformCenter.y, hint.x - platformCenter.x);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const approxR = Math.hypot(hint.x - platformCenter.x, hint.y - platformCenter.y);

  const samples = [];
  for (let dr = -searchRadius; dr <= searchRadius; dr += 0.5) {
    const r = approxR + dr;
    const x = Math.round(platformCenter.x + r * cos);
    const y = Math.round(platformCenter.y + r * sin);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    samples.push({ dr, gray: grayAt(frame, width, x, y) });
  }
  if (samples.length === 0) return hint;

  let minGray = Math.min(...samples.map((s) => s.gray));
  const dark = samples.filter((s) => s.gray <= minGray + 10);
  let sw = 0;
  let sdr = 0;
  for (const s of dark) {
    const w = 255 - s.gray;
    sw += w;
    sdr += s.dr * w;
  }
  const bestDr = sw > 0 ? sdr / sw : 0;
  const r = approxR + bestDr;
  return { x: platformCenter.x + r * cos, y: platformCenter.y + r * sin };
}

function measureVideo(name, frame, width, height) {
  const result = detectMazeFromFrames([frame], width, height);
  const holes = result.geometry.holes ?? [];
  const platformCenter = result.geometry.platformCenter;
  if (!platformCenter || holes.length === 0) return null;

  const errors = [];
  for (const hole of holes.filter((h) => h.source === 'detected')) {
    const hint = { x: hole.x, y: hole.y };
    const gtDarkest = darkestClusterCenter(frame, width, height, hint);
    const gtRadial = radialApertureCenter(frame, width, height, platformCenter, hint);
    const gt = {
      x: (gtDarkest.x + gtRadial.x) / 2,
      y: (gtDarkest.y + gtRadial.y) / 2,
    };

    const dx = hole.x - gt.x;
    const dy = hole.y - gt.y;
    const dist = Math.hypot(dx, dy);
    const radialUnit = {
      x: (hole.x - platformCenter.x) / Math.hypot(hole.x - platformCenter.x, hole.y - platformCenter.y),
      y: (hole.y - platformCenter.y) / Math.hypot(hole.x - platformCenter.x, hole.y - platformCenter.y),
    };
    const radialErr = dx * radialUnit.x + dy * radialUnit.y; // + = outward bias in prediction
    const tangentialErr = dx * -radialUnit.y + dy * radialUnit.x;

    errors.push({ id: hole.id, dx, dy, dist, radialErr, tangentialErr });
  }

  const avg = (key) => errors.reduce((s, e) => s + e[key], 0) / errors.length;
  const dists = errors.map((e) => e.dist).sort((a, b) => a - b);

  // Overlay transform round-trip (not hole-specific)
  const boxes = [
    { displayWidth: 640, displayHeight: 480, videoWidth: 640, videoHeight: 480 },
    { displayWidth: 400, displayHeight: 240, videoWidth: 640, videoHeight: 480 },
    { displayWidth: 320, displayHeight: 280, videoWidth: 640, videoHeight: 480 },
  ];
  let maxTransformErr = 0;
  for (const box of boxes) {
    for (const pt of holes.slice(0, 5)) {
      const back = displayToVideo(videoToDisplay(pt, box), box);
      maxTransformErr = Math.max(maxTransformErr, Math.hypot(back.x - pt.x, back.y - pt.y));
    }
  }

  return {
    confidence: result.confidence,
    holeCount: holes.length,
    detected: errors.length,
    meanDx: avg('dx'),
    meanDy: avg('dy'),
    meanRadialErr: avg('radialErr'),
    meanTangentialErr: avg('tangentialErr'),
    maxErr: Math.max(...dists),
    medianErr: dists[Math.floor(dists.length / 2)],
    maxTransformErr,
    perHole: errors,
  };
}

const summary = {};
for (const name of ['test50', 'test51', 'test53']) {
  const frame = extractFrame(name);
  summary[name] = measureVideo(name, frame, 640, 480);
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(summary[name], null, 2));
}

console.log('\n=== OFFSET SUMMARY (predicted - groundTruth) ===');
for (const [name, m] of Object.entries(summary)) {
  if (!m) continue;
  console.log(
    `${name}: meanDx=${m.meanDx.toFixed(2)} meanDy=${m.meanDy.toFixed(2)} ` +
      `radial=${m.meanRadialErr.toFixed(2)} tangential=${m.meanTangentialErr.toFixed(2)} ` +
      `max=${m.maxErr.toFixed(2)} median=${m.medianErr.toFixed(2)} transform=${m.maxTransformErr.toFixed(4)}`,
  );
}
