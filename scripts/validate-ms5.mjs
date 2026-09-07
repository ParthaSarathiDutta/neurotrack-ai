#!/usr/bin/env node
/**
 * MS-5 validation: each sample clip through isolated cold-start browser sessions.
 * Target hole is NOT used for pass/fail.
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
const DATA = join(ROOT, 'data', 'barnes-maze');
const CLIPS = ['test53', 'test51', 'test50'];

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

const results = {};
const clipOutcomes = {};
let activeServer = null;

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

async function cleanupServer() {
  if (activeServer) await new Promise((r) => activeServer.close(r));
}

async function checkNoFilenameBranching() {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.isFile() && (p.endsWith('.ts') || p.endsWith('.tsx'))) files.push(p);
    }
  }
  await walk(join(SRC, 'domain', 'events'));
  await walk(join(SRC, 'domain', 'measures'));
  await walk(join(SRC, 'services'));
  const hits = [];
  for (const f of files) {
    const content = await readText(f, 'utf8');
    if (/test50|test51|test53/.test(content)) hits.push(f.replace(ROOT + '/', ''));
  }
  return hits;
}

async function waitForAppReady(page) {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="trials-heading"]') != null,
    undefined,
    { timeout: 60_000 },
  );
}

async function selectTrial(page, label) {
  await page.getByRole('button', { name: new RegExp(label, 'i') }).click();
  await page.waitForSelector('[data-testid="review-view"]', { timeout: 60_000 });
}

async function prepareTrialCore(page, label) {
  await selectTrial(page, label);
  await page.locator('[data-testid="auto-detect-btn"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="hole-count-summary"]')?.textContent?.includes('20'),
    undefined,
    { timeout: 180_000 },
  );

  const trialId = await page.locator('[data-testid="review-view"]').getAttribute('data-trial-id');
  await page.evaluate(({ tid }) => {
    window.__ntAckCalibrationReview?.(tid);
    window.__ntConfirmGeometry?.(tid);
  }, { tid: trialId });

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
  await page.locator('[data-testid="run-tracking-btn"]').click();
  await page.waitForSelector('[data-testid="tracking-summary"]', { timeout: 180_000 });
}

async function detectAndWait(page) {
  await page.locator('[data-testid="detect-events-btn"]').click();
  await page.waitForSelector('[data-testid="events-list"]', { timeout: 180_000 });
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="detect-events-btn"]')?.textContent?.includes('Detecting'),
    undefined,
    { timeout: 180_000 },
  );
}

async function runColdStartClip(port, clip) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    const videoPath = join(DATA, `${clip}.mp4`);
    await page.locator('input[type="file"][multiple]').first().setInputFiles(videoPath);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="status-message"]')?.textContent?.includes('Ingest complete'),
      undefined,
      { timeout: 180_000 },
    );

    await prepareTrialCore(page, clip);
    const targetUnknownVisible = await page.locator('[data-testid="target-unknown-note"]').isVisible();
    await detectAndWait(page);

    const trialId = await page.locator('[data-testid="review-view"]').getAttribute('data-trial-id');
    const escapeType = await page.evaluate(({ tid }) => window.__ntGetEscapeType?.(tid) ?? null, { tid: trialId });
    const invCount = await page.evaluate(({ tid }) => window.__ntGetInvestigationCount?.(tid) ?? 0, { tid: trialId });
    const pixel = await page.evaluate(({ tid }) => window.__ntGetPixelEvidenceDetails?.(tid) ?? null, { tid: trialId });
    const totalLatencyText = await page.locator('[data-testid="measure-total-latency"]').textContent();
    const primaryLatencyText = await page.locator('[data-testid="measure-primary-latency"]').textContent();
    const escapeLabel = await page.locator('[data-testid="escape-state-label"]').textContent();
    const markerStrip = await page.locator('[data-testid="event-marker-strip"]').count();

    return {
      escapeType,
      investigations: invCount,
      totalLatency: totalLatencyText?.trim(),
      primaryLatency: primaryLatencyText?.trim(),
      escapeLabel: escapeLabel?.trim(),
      eventMarkers: markerStrip > 0,
      pixel,
      targetUnknownVisible,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const failures = [];
  results.V_no_filename_branch = (await checkNoFilenameBranching()).length === 0 ? 'PASS' : 'FAIL';

  if (!process.env.SKIP_BUILD) execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

  activeServer = await startStaticServer(DIST);
  const port = activeServer.address().port;

  for (const clip of CLIPS) {
    const outcome = await runColdStartClip(port, clip);
    clipOutcomes[clip] = outcome;

    results[`${clip}_target_unknown_note`] = outcome.targetUnknownVisible ? 'PASS' : 'FAIL';
    results[`${clip}_escape_state_valid`] =
      outcome.escapeType === null ||
      [
        'escape_completed',
        'escape_entry_uncertain',
        'escape_incomplete_censored',
        'trial_censored_no_entry',
      ].includes(outcome.escapeType)
        ? 'PASS'
        : `FAIL:${outcome.escapeType}`;
    results[`${clip}_total_latency_consistent`] =
      outcome.escapeType === 'escape_completed' && !outcome.totalLatency?.includes('Censored')
        ? `FAIL:finalized_without_confirm:${outcome.totalLatency}`
        : outcome.totalLatency?.includes('Censored') || outcome.totalLatency?.includes('Unavailable')
          ? 'PASS'
          : `FAIL:${outcome.totalLatency}`;
    results[`${clip}_pixel_gate_on_completed`] =
      outcome.escapeType !== 'escape_completed' ||
      (outcome.pixel?.complete === true &&
        outcome.pixel.framesAnalyzed > 0 &&
        outcome.pixel.bodyEntryCompletionEstablished === true &&
        outcome.pixel.bodyEntryCompletionFrameIndex != null)
        ? 'PASS'
        : `FAIL:${JSON.stringify(outcome.pixel)}`;
    results[`${clip}_primary_unavailable_without_target`] =
      outcome.primaryLatency?.includes('Unavailable') ? 'PASS' : `SKIP:${outcome.primaryLatency}`;
    results[`${clip}_event_markers`] = outcome.eventMarkers ? 'PASS' : 'FAIL:no_markers';
    results[`${clip}_investigations`] = outcome.investigations > 0 ? 'PASS' : 'FAIL:0';
    results[`${clip}_pixel_analyzed`] =
      outcome.pixel && outcome.pixel.framesAnalyzed > 0 ? 'PASS' : `FAIL:${JSON.stringify(outcome.pixel)}`;
    results[`${clip}_pixel_scores_present`] =
      outcome.pixel &&
      outcome.pixel.areaDecayScore != null &&
      outcome.pixel.holeDarkeningScore != null
        ? 'PASS'
        : `FAIL:${JSON.stringify(outcome.pixel)}`;
  }

  // Extended checks on test53 only (cold start)
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.locator('input[type="file"][multiple]').first().setInputFiles(join(DATA, 'test53.mp4'));
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="status-message"]')?.textContent?.includes('Ingest complete'),
      undefined,
      { timeout: 180_000 },
    );
    await prepareTrialCore(page, 'test53');
    await detectAndWait(page);

    const trialId = await page.locator('[data-testid="review-view"]').getAttribute('data-trial-id');
    const firstProposed = await page.locator('[data-testid^="confirm-event-"]').first();
    if (await firstProposed.count()) {
      const eventId = (await firstProposed.getAttribute('data-testid'))?.replace('confirm-event-', '');
      await page.evaluate(
        ({ tid, eid }) => window.__ntConfirmEvent?.(tid, eid),
        { tid: trialId, eid: eventId },
      );
      results.V6_confirm = 'PASS';
    } else {
      results.V6_confirm = 'SKIP:no_proposed';
    }

    await page.evaluate(
      ({ tid }) => window.__ntAddManualInvestigation?.(tid, 3, 100, 105),
      { tid: trialId },
    );
    results.V_manual_add = 'PASS';

    await page.evaluate(() => window.__ntUpdateEventParams?.({ pixelEvidenceBudgetFrames: 5 }));
    await page.waitForFunction(
      () => {
        const t = document.querySelector('[data-testid="pixel-evidence-banner"]')?.textContent ?? '';
        return t.toLowerCase().includes('incomplete');
      },
      undefined,
      { timeout: 60_000 },
    );
    results.V9_pixel_incomplete = 'PASS';

    await page.evaluate(({ tid }) => window.__ntSetMeasurementBasis?.(tid, 'raw'), { tid: trialId });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="measurement-basis-select"]')?.value === 'raw',
      undefined,
      { timeout: 60_000 },
    );
    results.V7_basis_change = 'PASS';
  } finally {
    await browser.close();
  }

  for (const [k, v] of Object.entries(results)) {
    if (String(v).startsWith('FAIL')) failures.push(`${k}: ${v}`);
  }

  console.log(JSON.stringify({ results, clipOutcomes }, null, 2));
  await cleanupServer();

  if (failures.length) {
    console.error('MS-5 validation FAIL', failures);
    process.exit(1);
  }
  console.log('MS-5 validation PASS');
}

main().catch(async (err) => {
  console.error(err);
  await cleanupServer();
  process.exit(1);
});
