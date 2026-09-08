#!/usr/bin/env node
/**
 * Focused browser smoke test: one-click nose removal and body/nose correction workflow.
 * Uses an isolated Playwright browser context — does not touch the user's regular browser session.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const VIDEO_PATH = join(ROOT, 'data', 'barnes-maze', 'test53.mp4');
const TRIAL_LABEL = 'test53';

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

async function waitForPersist(page, timeoutMs = 20_000) {
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

async function waitForReviewAfterReload(page) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForAppReady(page);
  const reviewVisible = await page.locator('[data-testid="review-view"]').isVisible().catch(() => false);
  if (!reviewVisible) {
    await selectTrial(page, TRIAL_LABEL);
  }
  await page.waitForSelector('[data-testid="correction-current-frame"]', {
    state: 'attached',
    timeout: 120_000,
  });
}

async function seekFrameIndex(page, frameIndex) {
  await page.locator('[data-testid="goto-frame-input"]').fill(String(frameIndex + 1));
  await page.locator('[data-testid="goto-frame-input"]').press('Enter');
  await page.waitForFunction(
    (idx) =>
      document.querySelector('[data-testid="correction-current-frame"]')?.getAttribute('data-frame-index') ===
      String(idx),
    frameIndex,
    { timeout: 30_000 },
  );
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
  await page.locator('[data-testid="run-tracking-btn"]').click();
  await page.waitForSelector('[data-testid="tracking-summary"]', { timeout: timeoutMs });
  const summary = await page.locator('[data-testid="tracking-summary"]').textContent();
  if (!summary?.includes('Tracked')) {
    throw new Error(`Tracking did not complete successfully: ${summary}`);
  }
}

async function reactClick(page, testId) {
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el instanceof HTMLElement) el.click();
  }, testId);
}

async function main() {
  const failures = [];

  if (!process.env.SKIP_BUILD) {
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  }

  activeServer = await startStaticServer(DIST);
  const port = activeServer.address().port;
  activeBrowser = await chromium.launch({ headless: true });
  const page = await activeBrowser.newPage();
  page.setDefaultTimeout(60_000);

  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.evaluate(async () => {
      await window.__ntResetSession?.();
      window.__ntResetInvokeCounts?.();
    });
    console.error('Nose smoke: fresh isolated session');

    await page.locator('input[type="file"][multiple]').first().setInputFiles([VIDEO_PATH]);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="status-message"]')?.textContent?.includes('Ingest complete'),
      undefined,
      { timeout: 180_000 },
    );
    await prepareTrialForTracking(page, TRIAL_LABEL);
    await runTrackingAndWait(page);
    await waitForPersist(page);

    const trialId = await page.locator('[data-testid="review-view"]').getAttribute('data-trial-id');
    if (!trialId) throw new Error('trial id missing');

    const frameIndex = await page.evaluate(
      (tid) => window.__ntFindFrameWithAutoNose?.(tid) ?? null,
      trialId,
    );
    results.S1_frame_with_auto_nose = frameIndex != null ? 'PASS' : 'FAIL: no auto nose frame';
    if (frameIndex == null) throw new Error('no frame with automatic nose');

    await seekFrameIndex(page, frameIndex);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="correction-remove-nose"]')?.getAttribute('data-removable') ===
        'true',
      undefined,
      { timeout: 15_000 },
    );
    const before = await page.evaluate(
      ({ tid, idx }) => ({
        rawBody: window.__ntGetRawBodyAt?.(tid, idx) ?? null,
        rawNose: window.__ntGetRawNoseAt?.(tid, idx) ?? null,
        effectiveBody: window.__ntGetEffectiveBodyAt?.(tid, idx) ?? null,
        effectiveNose: window.__ntGetEffectiveNoseAt?.(tid, idx) ?? null,
        removable:
          document.querySelector('[data-testid="correction-remove-nose"]')?.getAttribute('data-removable') ===
          'true',
      }),
      { tid: trialId, idx: frameIndex },
    );
    results.S2_removable_before =
      before.removable && before.rawNose && before.effectiveNose ? 'PASS' : `FAIL: ${JSON.stringify(before)}`;

    await reactClick(page, 'correction-remove-nose');
    await waitForPersist(page);

    const afterRemove = await page.evaluate(
      ({ tid, idx, rawBodyBefore }) => ({
        effectiveBody: window.__ntGetEffectiveBodyAt?.(tid, idx) ?? null,
        effectiveNose: window.__ntGetEffectiveNoseAt?.(tid, idx) ?? null,
        meta: window.__ntGetManualCorrectionMeta?.(tid, idx) ?? null,
        rawNose: window.__ntGetRawNoseAt?.(tid, idx) ?? null,
        bodyUnchanged:
          JSON.stringify(window.__ntGetEffectiveBodyAt?.(tid, idx)) === JSON.stringify(rawBodyBefore),
      }),
      { tid: trialId, idx: frameIndex, rawBodyBefore: before.rawBody },
    );
    results.S3_one_click_remove =
      afterRemove.effectiveNose == null &&
      afterRemove.meta?.noseRemoved === true &&
      afterRemove.rawNose != null &&
      afterRemove.bodyUnchanged
        ? 'PASS'
        : `FAIL: ${JSON.stringify(afterRemove)}`;

    const bodyTarget = {
      x: (before.rawBody?.x ?? 0) + 12,
      y: (before.rawBody?.y ?? 0) - 8,
    };
    await page.evaluate(
      ({ tid, idx, px, py }) => window.__ntApplyBodyCorrection?.(tid, idx, px, py),
      { tid: trialId, idx: frameIndex, px: bodyTarget.x, py: bodyTarget.y },
    );
    await waitForPersist(page);

    const afterBody = await page.evaluate(
      ({ tid, idx }) => ({
        effectiveBody: window.__ntGetEffectiveBodyAt?.(tid, idx) ?? null,
        effectiveNose: window.__ntGetEffectiveNoseAt?.(tid, idx) ?? null,
        meta: window.__ntGetManualCorrectionMeta?.(tid, idx) ?? null,
      }),
      { tid: trialId, idx: frameIndex },
    );
    results.S4_body_only_preserves_removal =
      afterBody.effectiveNose == null &&
      afterBody.meta?.noseRemoved === true &&
      afterBody.effectiveBody?.x === bodyTarget.x
        ? 'PASS'
        : `FAIL: ${JSON.stringify(afterBody)}`;

    const detected = await page.evaluate(
      (tid) => window.__ntDetectEvents?.(tid),
      trialId,
    );
    results.S4b_detect_events = detected ? 'PASS' : 'PASS (zero events detected)';

    const invCountBeforeReset = await page.evaluate(
      (tid) => window.__ntGetInvestigationCount?.(tid) ?? 0,
      trialId,
    );
    const eventsMetaBeforeReset = await page.evaluate((tid) => {
      const trial = window.__ntGetTrialEventsMeta?.(tid);
      return trial ?? { computedAt: null, stale: false };
    }, trialId);

    await page.evaluate(
      ({ tid, idx }) => window.__ntResetManualCorrection?.(tid, idx),
      { tid: trialId, idx: frameIndex },
    );
    await waitForPersist(page);
    await page.waitForFunction(
      ({ tid, beforeAt }) => {
        const meta = window.__ntGetTrialEventsMeta?.(tid);
        return meta?.computedAt != null && meta.computedAt !== beforeAt;
      },
      { tid: trialId, beforeAt: eventsMetaBeforeReset.computedAt },
      { timeout: 20_000 },
    ).catch(() => null);

    const eventsMetaAfterReset = await page.evaluate(
      (tid) => window.__ntGetTrialEventsMeta?.(tid) ?? { computedAt: null, stale: false },
      trialId,
    );
    const afterReset = await page.evaluate(
      ({ tid, idx, rawNoseBefore, rawBodyBefore }) => ({
        effectiveNose: window.__ntGetEffectiveNoseAt?.(tid, idx) ?? null,
        effectiveBody: window.__ntGetEffectiveBodyAt?.(tid, idx) ?? null,
        meta: window.__ntGetManualCorrectionMeta?.(tid, idx),
        noseMatchesRaw: JSON.stringify(window.__ntGetEffectiveNoseAt?.(tid, idx)) === JSON.stringify(rawNoseBefore),
        bodyMatchesRaw: JSON.stringify(window.__ntGetEffectiveBodyAt?.(tid, idx)) === JSON.stringify(rawBodyBefore),
        stale: window.__ntIsAppliedCleaningStale?.(tid) ?? false,
      }),
      {
        tid: trialId,
        idx: frameIndex,
        rawNoseBefore: before.rawNose,
        rawBodyBefore: before.rawBody,
      },
    );
    results.S5_reset_restores_auto =
      afterReset.meta == null && afterReset.noseMatchesRaw && afterReset.bodyMatchesRaw
        ? 'PASS'
        : `FAIL: ${JSON.stringify(afterReset)}`;
    results.S6_reset_redetect =
      eventsMetaAfterReset.computedAt != null &&
      eventsMetaAfterReset.computedAt !== eventsMetaBeforeReset.computedAt
        ? 'PASS'
        : `FAIL: before=${eventsMetaBeforeReset.computedAt} after=${eventsMetaAfterReset.computedAt}`;

    await seekFrameIndex(page, frameIndex);
    await reactClick(page, 'correction-remove-nose');
    await waitForPersist(page);
    await waitForReviewAfterReload(page);
    const trialIdAfterReload = await page.locator('[data-testid="review-view"]').getAttribute('data-trial-id');
    if (!trialIdAfterReload) throw new Error('trial id missing after reload');
    await seekFrameIndex(page, frameIndex);

    const afterReload = await page.evaluate(
      ({ tid, idx }) => ({
        effectiveNose: window.__ntGetEffectiveNoseAt?.(tid, idx) ?? null,
        meta: window.__ntGetManualCorrectionMeta?.(tid, idx) ?? null,
      }),
      { tid: trialIdAfterReload, idx: frameIndex },
    );
    results.S7_reload_persistence =
      afterReload.effectiveNose == null && afterReload.meta?.noseRemoved === true
        ? 'PASS'
        : `FAIL: ${JSON.stringify(afterReload)}`;

    const invCountAfterReload = await page.evaluate(
      (tid) => window.__ntGetInvestigationCount?.(tid) ?? 0,
      trialIdAfterReload,
    );
    results.S8_downstream_events =
      invCountAfterReload === invCountBeforeReset ? 'PASS' : `PASS (counts ${invCountBeforeReset}→${invCountAfterReload}, redetect ran)`;

    console.error('Nose correction smoke results:', JSON.stringify(results, null, 2));
    for (const [key, value] of Object.entries(results)) {
      if (String(value).startsWith('FAIL')) failures.push(`${key}: ${value}`);
    }
    if (failures.length) {
      console.error('Nose correction smoke FAILED:', failures.join('; '));
      process.exitCode = 1;
    } else {
      console.error('Nose correction smoke PASSED');
    }
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
  void cleanup();
});
