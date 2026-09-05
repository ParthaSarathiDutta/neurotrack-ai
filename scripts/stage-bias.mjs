#!/usr/bin/env node
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
const { findConnectedComponents } = await import(
  pathToFileURL(join(ROOT, 'src/domain/calibration/connectedComponents.ts')).href
);
const { otsuThreshold } = await import(
  pathToFileURL(join(ROOT, 'src/domain/calibration/otsu.ts')).href
);
const { refineDetectedHoleCentroids } = await import(
  pathToFileURL(join(ROOT, 'src/domain/calibration/refineHoles.ts')).href
);
const { fitHoleRing } = await import(
  pathToFileURL(join(ROOT, 'src/domain/calibration/ringFit.ts')).href
);
const { fitCircle } = await import(
  pathToFileURL(join(ROOT, 'src/domain/calibration/circleFit.ts')).href
);

function extractFrame(name) {
  const rawPath = join(DATA, `.stage-${name}.raw`);
  execSync(`ffmpeg -y -loglevel error -i "${join(DATA, `${name}.mp4`)}" -vframes 1 -f rawvideo -pix_fmt rgba "${rawPath}"`, { stdio: 'pipe' });
  const buf = readFileSync(rawPath);
  unlinkSync(rawPath);
  return new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
}

function gray(f, w, x, y) { return f[(y * w + x) * 4]; }

function radialGt(frame, w, h, pc, hint) {
  const angle = Math.atan2(hint.y - pc.y, hint.x - pc.x);
  const r0 = Math.hypot(hint.x - pc.x, hint.y - pc.y);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const samples = [];
  for (let dr = -14; dr <= 14; dr += 0.25) {
    const r = r0 + dr;
    const x = Math.round(pc.x + r * cos), y = Math.round(pc.y + r * sin);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    samples.push({ dr, g: gray(frame, w, x, y) });
  }
  const minG = Math.min(...samples.map(s => s.g));
  const dark = samples.filter(s => s.g <= minG + 12);
  let sw = 0, sdr = 0;
  for (const s of dark) { const wt = 255 - s.g; sw += wt; sdr += s.dr * wt; }
  const r = r0 + (sw ? sdr / sw : 0);
  return { x: pc.x + r * cos, y: pc.y + r * sin };
}

function measureStage(name, frame, w, h) {
  const det = detectMazeFromFrames([frame], w, h);
  const pc = det.geometry.platformCenter;
  const final = det.geometry.holes ?? [];
  if (!pc) return;

  // Re-extract blobs using same pipeline internals (duplicate extract logic briefly)
  const threshold = otsuThreshold(frame, w, h);
  const brightMask = new Array(w * h);
  for (let i = 0; i < w * h; i++) brightMask[i] = frame[i * 4] >= threshold;
  const brightBlobs = findConnectedComponents(brightMask, w, h);
  brightBlobs.sort((a, b) => b.area - a.area);
  const roughCenter = brightBlobs[0].centroid;
  const roughRadius = Math.sqrt(brightBlobs[0].area / Math.PI);

  const bandPixels = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dist = Math.hypot(x - roughCenter.x, y - roughCenter.y);
    if (dist >= roughRadius * 0.55 && dist <= roughRadius * 1.15) bandPixels.push(frame[(y * w + x) * 4]);
  }
  bandPixels.sort((a, b) => a - b);
  const bandMedian = bandPixels[Math.floor(bandPixels.length / 2)] ?? threshold;

  // Use best offset from full detect (approximate - run all offsets)
  let bestBlobs = [];
  for (const offset of [8,10,12,14,16,18,20,22]) {
    const darkThreshold = Math.min(threshold, bandMedian - offset);
    const darkMask = new Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const dist = Math.hypot(x - roughCenter.x, y - roughCenter.y);
      darkMask[idx] = frame[idx * 4] < darkThreshold && dist >= roughRadius * 0.55 && dist <= roughRadius * 1.15;
    }
    const darkBlobs = findConnectedComponents(darkMask, w, h);
    const expected = Math.PI * (roughRadius * 0.045) ** 2;
    const cands = darkBlobs.filter(b => b.area >= expected * 0.06 * 0.08 && b.area <= expected * 8 && b.compactness > 0.12);
    if (cands.length >= 18) { bestBlobs = cands; break; }
  }

  const blobPts = bestBlobs.map(b => b.centroid);
  const circle = fitCircle(blobPts);
  const filtered = blobPts.filter(p => {
    const d = Math.hypot(p.x - circle.center.x, p.y - circle.center.y);
    return d >= circle.radius * 0.88 && d <= circle.radius * 1.12;
  });
  const refined = refineDetectedHoleCentroids(frame, w, h, filtered);
  const ring = fitHoleRing(refined, circle.center);

  const matchToGt = (pts, label) => {
    const errs = [];
    for (const p of pts) {
      const gt = radialGt(frame, w, h, pc, p);
      errs.push({ dx: p.x - gt.x, dy: p.y - gt.y, dist: Math.hypot(p.x - gt.x, p.y - gt.y) });
    }
    const avg = k => errs.reduce((s,e)=>s+e[k],0)/errs.length;
    const dists = errs.map(e=>e.dist).sort((a,b)=>a-b);
    console.log(`${name} ${label}: meanDx=${avg('dx').toFixed(2)} meanDy=${avg('dy').toFixed(2)} max=${dists[dists.length-1].toFixed(2)} med=${dists[Math.floor(dists.length/2)].toFixed(2)} n=${errs.length}`);
  };

  matchToGt(filtered, 'blobCentroid');
  matchToGt(refined, 'afterRefine');
  for (const hole of final.filter(h => h.source === 'detected')) {
    const gt = radialGt(frame, w, h, pc, hole);
    // single final aggregate below
  }
  const finalErrs = final.filter(h => h.source === 'detected').map(h => {
    const gt = radialGt(frame, w, h, pc, h);
    return { dx: h.x - gt.x, dy: h.y - gt.y, dist: Math.hypot(h.x - gt.x, h.y - gt.y) };
  });
  const avg = k => finalErrs.reduce((s,e)=>s+e[k],0)/finalErrs.length;
  const dists = finalErrs.map(e=>e.dist).sort((a,b)=>a-b);
  console.log(`${name} final: meanDx=${avg('dx').toFixed(2)} meanDy=${avg('dy').toFixed(2)} max=${dists[dists.length-1].toFixed(2)} med=${dists[Math.floor(dists.length/2)].toFixed(2)}`);
}

for (const n of ['test50','test51','test53']) measureStage(n, extractFrame(n), 640, 480);
