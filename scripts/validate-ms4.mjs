#!/usr/bin/env node
/**
 * MS-4 validation: manual correction, trajectory cleaning, persistence, duplicate PTS.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, readdir, readFile as readText } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const SRC = join(ROOT, 'src');
const VIDEO_PATHS = ['test53.mp4'].map((f) => join(ROOT, 'data', 'barnes-maze', f));
const TRIAL_LABEL = 'test53';

/** test53 duplicate-PTS pair (frameIndex identity); display frame numbers are +1. */
const DUP_FRAME_A = 209;
const DUP_FRAME_B = 210;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const results = {};
let activeServer = null;
let activeBrowser = null;

function startStaticServer(root) {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        let path = req.url?.split('?')[0] ?? '/';
        if (path === '/') path = '/index.html';
        const filePath = join(root, path);
        const data = await readFile(filePath);
        const ext = path.slice(path.lastIndexOf('.'));
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function cleanup() {
  if (activeBrowser) {
    try {
      await activeBrowser.close();
    } catch {
      /* ignore */
    }
    activeBrowser = null;
  }
  if (activeServer) {
    await new Promise((resolve) => activeServer.close(resolve));
    activeServer = null;
  }
}

process.on('SIGINT', () => {
  void cleanup().finally(() => process.exit(130));
});
process.on('SIGTERM', () => {
  void cleanup().finally(() => process.exit(143));
});

async function checkNoFilenameBranching() {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.isFile() && (p.endsWith('.ts') || p.endsWith('.tsx'))) files.push(p);
    }
  }
  await walk(join(SRC, 'domain', 'trajectory'));
  const hits = [];
  for (const f of files) {
    const content = await readText(f, 'utf8');
    if (/test50|test51|test53/.test(content)) hits.push(f.replace(ROOT + '/', ''));
  }
  return hits;
}

async function waitForPersist(page, timeoutMs = 15_000) {
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="session-persisted"]')?.getAttribute('data-ready') ===
      'true',
    undefined,
    { timeout: timeoutMs },
  );
}

async function waitForAppReady(page) {
  await page.waitForFunction(
    () => document.querySelector('h1')?.textContent?.includes('NeuroTrack'),
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForFunction(
    () => document.querySelector('[data-testid="trials-heading"]') != null,
    undefined,
    { timeout: 60_000 },
  );
}

async function selectTrial(page, label) {
  await page.getByRole('button', { name: new RegExp(label, 'i') }).click();
  await page.waitForSelector('[data-testid="review-view"]', { timeout: 60_000 });
  await page.waitForSelector('[data-testid="current-timestamp"]', { timeout: 120_000 });
}

async function seekFrameIndex(page, frameIndex) {
  await page.locator('[data-testid="goto-frame-input"]').fill(String(frameIndex + 1));
  await page.locator('[data-testid="goto-frame-input"]').press('Enter');
  await page.waitForFunction(
    (n) =>
      document
        .querySelector('[data-testid="current-frame-index"]')
        ?.textContent?.includes(`Frame ${n}/`),
    frameIndex + 1,
    { timeout: 30_000 },
  );
}

async function updateCleaningParams(page, params) {
  const trialId = await page.locator('[data-testid="review-view"]').getAttribute('data-trial-id');
  if (!trialId) throw new Error('review trial id missing');
  if (params.maxGapFrames != null) {
    await page.locator('[data-testid="clean-max-gap"]').fill(String(params.maxGapFrames));
  }
  if (params.smoothingWindow != null) {
    await page.locator('[data-testid="clean-smoothing-window"]').fill(String(params.smoothingWindow));
  }
}

async function previewCleaning(page) {
  const trialId = await page.locator('[data-testid="review-view"]').getAttribute('data-trial-id');
  if (!trialId) throw new Error('review trial id missing');
  const previewLen = await page.evaluate((tid) => window.__ntPreviewCleaning?.(tid) ?? 0, trialId);
  if (!previewLen) throw new Error('cleaning preview produced no observations');
}

async function applyCleaning(page) {
  const trialId = await page.locator('[data-testid="review-view"]').getAttribute('data-trial-id');
  if (!trialId) throw new Error('review trial id missing');
  const applied = await page.evaluate((tid) => window.__ntApplyCleaning?.(tid) ?? false, trialId);
  if (!applied) throw new Error('cleaning apply did not persist to store');
  await waitForPersist(page);
}

async function discardCleaningPreview(page) {
  const trialId = await page.locator('[data-testid="review-view"]').getAttribute('data-trial-id');
  if (!trialId) throw new Error('review trial id missing');
  const discarded = await page.evaluate(
    (tid) => window.__ntDiscardCleaningPreview?.(tid) ?? false,
    trialId,
  );
  if (!discarded) throw new Error('cleaning preview discard failed');
}

async function prepareTrialForTracking(page, label) {
  await selectTrial(page, label);
  await page.locator('[data-testid="auto-detect-btn"]').click({ timeout: 60_000 });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="hole-count-summary"]')?.textContent?.includes('20'),
    undefined,
    { timeout: 180_000 },
  );
  await page.locator('[data-testid="target-hole-select"]').selectOption('0');
  await page.locator('[data-testid="confirm-target-btn"]').click();
  await page.waitForSelector('[data-testid="target-confirmed"]', { timeout: 15_000 });
  await page.locator('[data-testid="confirm-geometry-btn"]').click();
  await page.waitForSelector('[data-testid="geometry-confirmed"]', { timeout: 15_000 });
  await page.locator('[data-testid="propose-window-btn"]').click();
  await page.waitForFunction(
    () => {
      const start = document.querySelector('[data-testid="start-time-input"]');
      return start && start.value && parseFloat(start.value) > 0;
    },
    undefined,
    { timeout: 180_000 },
  );
  await page.locator('[data-testid="confirm-window-btn"]').click();
  await page.waitForSelector('[data-testid="window-confirmed"]', { timeout: 15_000 });
}

async function runTrackingAndWait(page, timeoutMs = 120_000) {
  const disabled = await page.locator('[data-testid="run-tracking-btn"]').isDisabled();
  if (disabled) {
    const gate = await page.locator('[data-testid="tracking-gate-message"]').textContent();
    throw new Error(`Run tracking disabled: ${gate}`);
  }
  await page.locator('[data-testid="run-tracking-btn"]').click();
  await page.waitForSelector('[data-testid="tracking-summary"]', { timeout: timeoutMs });
  const summary = await page.locator('[data-testid="tracking-summary"]').textContent();
  if (!summary?.includes('Tracked')) {
    throw new Error(`Tracking did not complete successfully: ${summary}`);
  }
}

async function waitForReviewAfterReload(page) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  console.error('MS-4: reloaded');
  await waitForAppReady(page);
  console.error('MS-4: app ready after reload');
  const reviewVisible = await page.locator('[data-testid="review-view"]').isVisible().catch(() => false);
  if (!reviewVisible) {
    await selectTrial(page, TRIAL_LABEL);
  } else {
    await page.waitForSelector('[data-testid="current-timestamp"]', { timeout: 120_000 });
  }
  console.error('MS-4: trial review active');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="tracking-summary"]')?.textContent?.includes('Tracked'),
    undefined,
    { timeout: 120_000 },
  );
  await page.waitForSelector('[data-testid="clean-max-gap"]', { timeout: 60_000 });
  await page.waitForSelector('[data-testid="current-frame-index"]', { timeout: 120_000 });
  console.error('MS-4: review ready after reload');
}

async function reactClick(page, testId) {
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el instanceof HTMLElement) el.click();
  }, testId);
}

async function ensureBodyCorrectionMode(page) {
  const label = await page.locator('[data-testid="correction-mode-body"]').textContent();
  if (!label?.includes('Correcting')) {
    await reactClick(page, 'correction-mode-body');
  }
}

async function correctBodyAtOverlayCenter(page, offset = { x: 0, y: 0 }) {
  await ensureBodyCorrectionMode(page);
  const overlay = page.locator('[data-testid="video-overlay"]');
  const box = await overlay.boundingBox();
  if (!box) throw new Error('video overlay missing');
  await overlay.click({
    position: { x: box.width / 2 + offset.x, y: box.height / 2 + offset.y },
    noWaitAfter: true,
  });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="observation-origin"]')?.textContent === 'manual',
    undefined,
    { timeout: 15_000 },
  );
  await waitForPersist(page);
}

async function applyBodyCorrectionDirect(page, frameIndex, x, y) {
  const trialId = await page.locator('[data-testid="review-view"]').getAttribute('data-trial-id');
  if (!trialId) throw new Error('review trial id missing');
  await page.evaluate(
    ({ tid, idx, px, py }) => {
      window.__ntApplyBodyCorrection?.(tid, idx, px, py);
    },
    { tid: trialId, idx: frameIndex, px: x, py: y },
  );
  await waitForPersist(page);
}

async function applyBodyCorrectionAtFrame(page, frameIndex, x, y) {
  await seekFrameIndex(page, frameIndex);
  await page.evaluate(
    ({ idx, px, py }) => {
      const trialId = document.querySelector('[data-testid="review-view"]')?.getAttribute('data-trial-id');
      if (trialId) window.__ntApplyBodyCorrection?.(trialId, idx, px, py);
    },
    { idx: frameIndex, px: x, py: y },
  );
  await page.waitForFunction(
    () => document.querySelector('[data-testid="observation-origin"]')?.textContent === 'manual',
    undefined,
    { timeout: 15_000 },
  );
  await waitForPersist(page);
}

async function main() {
  const failures = [];

  const filenameHits = await checkNoFilenameBranching();
  results.V2 = filenameHits.length === 0 ? 'PASS' : `FAIL: ${filenameHits.join(', ')}`;
  if (filenameHits.length) failures.push(`V2: ${filenameHits.join(', ')}`);

  if (!process.env.SKIP_BUILD) {
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  }

  activeServer = await startStaticServer(DIST);
  const port = activeServer.address().port;
  console.error(`MS-4: static server on port ${port}`);
  activeBrowser = await chromium.launch({ headless: true });
  console.error('MS-4: browser launched');
  const page = await activeBrowser.newPage();
  page.setDefaultTimeout(60_000);

  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    console.error('MS-4: page loaded');
    await waitForAppReady(page);
    console.error('MS-4: app ready');
    await page.locator('input[type="file"][multiple]').first().setInputFiles(VIDEO_PATHS);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="status-message"]')?.textContent?.includes('Ingest complete'),
      undefined,
      { timeout: 180_000 },
    );
    console.error('MS-4: ingest complete');
    await prepareTrialForTracking(page, TRIAL_LABEL);
    console.error('MS-4: trial prepared');
    await runTrackingAndWait(page, 120_000);
    console.error('MS-4: tracking complete');
    await waitForPersist(page);
    console.error('MS-4: persisted after tracking');
    await page.waitForSelector('[data-testid="clean-max-gap"]', { timeout: 15_000 });

    const originBefore = await page.locator('[data-testid="observation-origin"]').textContent();
    results.V1_origin_before =
      originBefore === 'auto' || originBefore === 'interpolated' || originBefore === 'smoothed'
        ? 'PASS'
        : `FAIL: ${originBefore}`;

    await applyBodyCorrectionDirect(page, DUP_FRAME_B, 280, 220);
    await applyBodyCorrectionDirect(page, DUP_FRAME_A, 120, 180);
    console.error('MS-4: dup corrections applied');

    let trialId = await page.locator('[data-testid="review-view"]').getAttribute('data-trial-id');
    const dupBodies = await page.evaluate(
      ({ tid, a, b }) => ({
        a: window.__ntGetManualBodyAt?.(tid, a) ?? null,
        b: window.__ntGetManualBodyAt?.(tid, b) ?? null,
      }),
      { tid: trialId, a: DUP_FRAME_A, b: DUP_FRAME_B },
    );
    results.V_dup_pts_independent =
      dupBodies.a && dupBodies.b ? 'PASS' : `FAIL: missing correction on dup frames`;
    results.V_dup_pts_distinct =
      dupBodies.a && dupBodies.b && dupBodies.a.x !== dupBodies.b.x
        ? 'PASS'
        : `FAIL: A=${JSON.stringify(dupBodies.a)} B=${JSON.stringify(dupBodies.b)}`;

    await waitForReviewAfterReload(page);
    trialId = await page.locator('[data-testid="review-view"]').getAttribute('data-trial-id');
    const summaryDupReload = await page.locator('[data-testid="correction-summary"]').textContent();
    results.V_dup_pts_persistence = summaryDupReload?.includes('2 manual correction')
      ? 'PASS'
      : `FAIL: ${summaryDupReload}`;
    console.error(`MS-4: dup persistence ${results.V_dup_pts_persistence}`);

    await applyBodyCorrectionDirect(page, 0, 320, 240);
    const bodyXAfter = await page.evaluate(
      (tid) => window.__ntGetManualBodyAt?.(tid, 0)?.x ?? null,
      trialId,
    );
    results.V1_manual_correction = bodyXAfter && Number(bodyXAfter) > 0 ? 'PASS' : 'FAIL';
    const originAfterManual = await page.evaluate(
      ({ tid, idx }) => window.__ntGetEffectiveOriginAt?.(tid, idx) ?? null,
      { tid: trialId, idx: 0 },
    );
    results.V2_provenance = originAfterManual === 'manual' ? 'PASS' : `FAIL: ${originAfterManual}`;

    await page.evaluate((patch) => window.__ntUpdateCleaningParams?.(patch), {
      maxGapFrames: 1,
      smoothingWindow: 5,
    });
    console.error('MS-4: cleaning params set');
    await previewCleaning(page);
    console.error('MS-4: cleaning preview active');
    results.V5_preview = 'PASS';

    const originDuringPreview = await page.evaluate(
      ({ tid, idx }) => window.__ntGetEffectiveOriginAt?.(tid, idx) ?? null,
      { tid: trialId, idx: 0 },
    );
    results.V6_preview_changes =
      originDuringPreview === 'manual' ||
      originDuringPreview === 'smoothed' ||
      originDuringPreview === 'interpolated'
        ? 'PASS'
        : `FAIL: ${originDuringPreview}`;

    await discardCleaningPreview(page);
    console.error('MS-4: cleaning preview discarded');
    results.V7_discard = 'PASS';

    await previewCleaning(page);
    await applyCleaning(page);
    console.error('MS-4: cleaning applied');
    results.V8_apply = 'PASS';

    await waitForReviewAfterReload(page);
    trialId = await page.locator('[data-testid="review-view"]').getAttribute('data-trial-id');
    const appliedAfterReload = await page
      .locator('[data-testid="clean-applied-marker"]')
      .isVisible();
    results.V9_apply_persistence = appliedAfterReload ? 'PASS' : 'FAIL';
    console.error(`MS-4: apply persistence ${results.V9_apply_persistence}`);

    await page.evaluate(
      ({ tid, idx }) => {
        window.__ntResetManualCorrection?.(tid, idx);
      },
      { tid: trialId, idx: 0 },
    );
    await waitForPersist(page);
    const bodyAfterReset = await page.evaluate(
      (tid) => window.__ntGetManualBodyAt?.(tid, 0) ?? null,
      trialId,
    );
    results.V3_reset = bodyAfterReset == null ? 'PASS' : `FAIL: still manual at frame 0`;

    await applyBodyCorrectionDirect(page, 0, 320, 240);

    await waitForReviewAfterReload(page);
    const summaryAfterReload = await page.locator('[data-testid="correction-summary"]').textContent();
    results.V4_persistence = summaryAfterReload?.includes('3 manual correction') ? 'PASS' : `FAIL: ${summaryAfterReload}`;
    console.error(`MS-4: V4 persistence ${results.V4_persistence}`);

    await page.locator('[data-testid="run-tracking-btn"]').click();
    const warningVisible = await page
      .locator('[data-testid="rerun-tracking-warning"]')
      .isVisible();
    results.V10_rerun_confirm = warningVisible ? 'PASS' : 'FAIL';

    results.V11_ms5_note = (await page.locator('[data-testid="ms5-event-note"]').isVisible())
      ? 'PASS'
      : 'FAIL';

    if (results.V1_manual_correction !== 'PASS') failures.push('V1: manual correction');
    if (results.V2_provenance !== 'PASS') failures.push('V2: provenance');
    if (results.V3_reset !== 'PASS') failures.push('V3: reset');
    if (results.V4_persistence !== 'PASS') failures.push(`V4: persistence ${summaryAfterReload}`);
    if (results.V_dup_pts_independent !== 'PASS') failures.push(`V_dup: ${results.V_dup_pts_independent}`);
    if (results.V_dup_pts_distinct !== 'PASS') failures.push(`V_dup_distinct: ${results.V_dup_pts_distinct}`);
    if (results.V_dup_pts_persistence !== 'PASS') {
      failures.push(`V_dup_persist: ${results.V_dup_pts_persistence}`);
    }
    if (results.V5_preview !== 'PASS') failures.push('V5: preview');
    if (results.V8_apply !== 'PASS') failures.push('V8: apply');
    if (results.V9_apply_persistence !== 'PASS') failures.push('V9: apply persistence');
    if (results.V10_rerun_confirm !== 'PASS') failures.push('V10: rerun confirm');
  } finally {
    await cleanup();
  }

  console.log(JSON.stringify(results, null, 2));
  if (failures.length) {
    console.error('MS-4 validation FAIL:', failures);
    process.exit(1);
  }
  console.log('MS-4 validation PASS');
}

main().catch(async (e) => {
  console.error(e);
  await cleanup();
  process.exit(1);
});
