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
const { fitCircle } = await import(
  pathToFileURL(join(ROOT, 'src/domain/calibration/circleFit.ts')).href
);
const { fitHoleRing } = await import(
  pathToFileURL(join(ROOT, 'src/domain/calibration/ringFit.ts')).href
);
const { otsuThreshold } = await import(
  pathToFileURL(join(ROOT, 'src/domain/calibration/otsu.ts')).href
);
const { findConnectedComponents } = await import(
  pathToFileURL(join(ROOT, 'src/domain/calibration/connectedComponents.ts')).href
);

const videoPath = join(DATA, 'test51.mp4');
const rawPath = join(DATA, '.diag-test51.raw');
execSync(
  `ffmpeg -y -loglevel error -i "${videoPath}" -vframes 1 -f rawvideo -pix_fmt rgba "${rawPath}"`,
  { stdio: 'pipe' },
);
const buf = readFileSync(rawPath);
unlinkSync(rawPath);
const ref = new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
const width = 640;
const height = 480;

const threshold = otsuThreshold(ref, width, height);
const brightMask = new Array(width * height);
for (let i = 0; i < width * height; i += 1) {
  brightMask[i] = ref[i * 4] >= threshold;
}
const brightBlobs = findConnectedComponents(brightMask, width, height);
brightBlobs.sort((a, b) => b.area - a.area);
const platform = brightBlobs[0];
const roughCenter = platform.centroid;
const roughRadius = Math.sqrt(platform.area / Math.PI);

console.log('roughCenter', roughCenter, 'roughRadius', roughRadius);

const darkMask = new Array(width * height);
const bandPixels = [];
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const dist = Math.hypot(x - roughCenter.x, y - roughCenter.y);
    if (dist >= roughRadius * 0.6 && dist <= roughRadius * 1.12) {
      bandPixels.push(ref[(y * width + x) * 4]);
    }
  }
}
bandPixels.sort((a, b) => a - b);
const bandMedian = bandPixels[Math.floor(bandPixels.length / 2)] ?? threshold;
const darkThreshold = Math.min(threshold, bandMedian - 12);

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const idx = y * width + x;
    const gray = ref[idx * 4];
    const dist = Math.hypot(x - roughCenter.x, y - roughCenter.y);
    const inBand = dist >= roughRadius * 0.6 && dist <= roughRadius * 1.12;
    darkMask[idx] = gray < darkThreshold && inBand;
  }
}

const darkBlobs = findConnectedComponents(darkMask, width, height);
const expectedHoleArea = Math.PI * (roughRadius * 0.045) ** 2;
const minArea = expectedHoleArea * 0.08;
const maxArea = expectedHoleArea * 6;

const holeCandidates = darkBlobs.filter(
  (b) =>
    b.area >= minArea &&
    b.area <= maxArea &&
    b.compactness > 0.15 &&
    Math.hypot(b.centroid.x - roughCenter.x, b.centroid.y - roughCenter.y) >= roughRadius * 0.55,
);

console.log('candidates', holeCandidates.length, 'darkThreshold', darkThreshold, 'otsu', threshold);

const candidatePoints = holeCandidates.map((b) => b.centroid);
const dists = candidatePoints.map((p) => Math.hypot(p.x - roughCenter.x, p.y - roughCenter.y));
const medianDist = [...dists].sort((a, b) => a - b)[Math.floor(dists.length / 2)];
const filteredPoints = candidatePoints.filter((p) => {
  const d = Math.hypot(p.x - roughCenter.x, p.y - roughCenter.y);
  return d >= medianDist * 0.82 && d <= medianDist * 1.18;
});

console.log('filtered', filteredPoints.length, 'medianDist', medianDist);

const circleFit = fitCircle(filteredPoints);
console.log('circleFit center', circleFit?.center, 'radius', circleFit?.radius, 'residual', circleFit?.residualPx);

const ring = fitHoleRing(filteredPoints, circleFit?.center);
console.log('ring center', ring?.center, 'radius', ring?.ringRadius, 'residual', ring?.residualPx);
console.log('detected', ring?.detectedCount, 'modeled', ring?.modelCount);

// Expected constitution center
const expected = { x: 284, y: 244 };
console.log('center error from constitution', Math.hypot(ring.center.x - expected.x, ring.center.y - expected.y));

// Per-hole residuals for detected
for (const h of ring.holes) {
  if (h.source === 'detected') {
    const r = Math.hypot(h.x - ring.center.x, h.y - ring.center.y);
    const slotAngle = (ring.rotationDeg + h.id * 18) * (Math.PI / 180);
    const ex = ring.center.x + ring.ringRadius * Math.cos(slotAngle);
    const ey = ring.center.y + ring.ringRadius * Math.sin(slotAngle);
    const slotDist = Math.hypot(h.x - ex, h.y - ey);
    if (slotDist > 5) {
      console.log(`hole ${h.id + 1}: slot residual ${slotDist.toFixed(1)} radial ${Math.abs(r - ring.ringRadius).toFixed(1)}`);
    }
  } else {
    console.log(`hole ${h.id + 1}: MODELED`);
  }
}

const full = detectMazeFromFrames([ref], width, height);
console.log('full detect success', full.success);
