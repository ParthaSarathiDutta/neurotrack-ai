#!/usr/bin/env node
import { execSync } from 'child_process';
import { readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data', 'barnes-maze');

const modules = {
  detect: await import(pathToFileURL(join(ROOT, 'src/domain/calibration/detectMaze.ts')).href),
  refine: await import(pathToFileURL(join(ROOT, 'src/domain/calibration/refineHoles.ts')).href),
  ring: await import(pathToFileURL(join(ROOT, 'src/domain/calibration/ringFit.ts')).href),
  cc: await import(pathToFileURL(join(ROOT, 'src/domain/calibration/connectedComponents.ts')).href),
  otsu: await import(pathToFileURL(join(ROOT, 'src/domain/calibration/otsu.ts')).href),
  circle: await import(pathToFileURL(join(ROOT, 'src/domain/calibration/circleFit.ts')).href),
};

function extractFrame(name) {
  const rawPath = join(DATA, `.trace-${name}.raw`);
  execSync(
    `ffmpeg -y -loglevel error -i "${join(DATA, `${name}.mp4`)}" -vframes 1 -f rawvideo -pix_fmt rgba "${rawPath}"`,
    { stdio: 'pipe' },
  );
  const buf = readFileSync(rawPath);
  unlinkSync(rawPath);
  return new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
}

function gray(frame, w, x, y) {
  return frame[(y * w + x) * 4];
}

/** Ground truth: center of dark band along radial scan (aperture midpoint). */
function radialDarkBandCenter(frame, w, h, pc, angle, rGuess, halfWidth = 12) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const samples = [];
  for (let dr = -halfWidth; dr <= halfWidth; dr += 0.25) {
    const r = rGuess + dr;
    const x = Math.round(pc.x + r * cos);
    const y = Math.round(pc.y + r * sin);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    samples.push({ dr, g: gray(frame, w, x, y) });
  }
  if (samples.length < 3) return null;
  const minG = Math.min(...samples.map((s) => s.g));
  const dark = samples.filter((s) => s.g <= minG + 15);
  let sw = 0;
  let sdr = 0;
  for (const s of dark) {
    const weight = 255 - s.g;
    sw += weight;
    sdr += s.dr * weight;
  }
  const dr = sw > 0 ? sdr / sw : 0;
  const r = rGuess + dr;
  return { x: pc.x + r * cos, y: pc.y + r * sin };
}

/** Edge-based GT: midpoint of steepest gradient along radial line. */
function radialGradientMidpoint(frame, w, h, pc, angle, rGuess, halfWidth = 14) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const samples = [];
  for (let dr = -halfWidth; dr <= halfWidth; dr += 0.5) {
    const r = rGuess + dr;
    const x = Math.round(pc.x + r * cos);
    const y = Math.round(pc.y + r * sin);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    samples.push({ dr, g: gray(frame, w, x, y) });
  }
  let maxGrad = 0;
  let gradDr = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const dg = Math.abs(samples[i].g - samples[i - 1].g);
    if (dg > maxGrad) {
      maxGrad = dg;
      gradDr = (samples[i].dr + samples[i - 1].dr) / 2;
    }
  }
  const r = rGuess + gradDr;
  return { x: pc.x + r * cos, y: pc.y + r * sin };
}

function stats(errors) {
  if (errors.length === 0) return null;
  const avg = (k) => errors.reduce((s, e) => s + e[k], 0) / errors.length;
  const dists = errors.map((e) => e.dist).sort((a, b) => a - b);
  return {
    meanDx: avg('dx'),
    meanDy: avg('dy'),
    meanRadial: avg('radial'),
    max: dists[dists.length - 1],
    median: dists[Math.floor(dists.length / 2)],
  };
}

function compare(name, frame, w, h) {
  const result = modules.detect.detectMazeFromFrames([frame], w, h);
  const pc = result.geometry.platformCenter;
  const ringR =
    result.geometry.holes?.[0] && pc
      ? Math.hypot(result.geometry.holes[0].x - pc.x, result.geometry.holes[0].y - pc.y)
      : 200;

  const errors = { final: [], blob: [], refined: [], gtBand: [], gtGrad: [] };

  for (const hole of result.geometry.holes ?? []) {
    if (hole.source !== 'detected' || !pc) continue;
    const angle = Math.atan2(hole.y - pc.y, hole.x - pc.x);
    const rGuess = Math.hypot(hole.x - pc.x, hole.y - pc.y);
    const gtBand = radialDarkBandCenter(frame, w, h, pc, angle, rGuess);
    const gtGrad = radialGradientMidpoint(frame, w, h, pc, angle, rGuess);
    if (!gtBand || !gtGrad) continue;
    const gt = { x: (gtBand.x + gtGrad.x) / 2, y: (gtBand.y + gtGrad.y) / 2 };

    const radial = { x: (hole.x - pc.x) / rGuess, y: (hole.y - pc.y) / rGuess };
    const add = (arr, pred) => {
      const dx = pred.x - gt.x;
      const dy = pred.y - gt.y;
      arr.push({
        dx,
        dy,
        dist: Math.hypot(dx, dy),
        radial: dx * radial.x + dy * radial.y,
      });
    };
    add(errors.final, hole);
    add(errors.gtBand, gtBand);
    add(errors.gtGrad, gtGrad);
  }

  console.log(`\n=== ${name} (pred - GT, GT=radial band+gradient midpoint) ===`);
  console.log('final:', stats(errors.final));
}

for (const name of ['test50', 'test51', 'test53']) {
  compare(name, extractFrame(name), 640, 480);
}
