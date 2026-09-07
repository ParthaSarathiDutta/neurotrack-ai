#!/usr/bin/env node
/**
 * MS-6 Checkpoint 4 — committed output integrity + load-example browser regression.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import * as XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const OUTPUTS = join(ROOT, 'outputs');
const SESSION_BUNDLE = join(OUTPUTS, 'bundles', 'all-clips-session.neurotrack.json');
const TEST53_MP4 = join(ROOT, 'data', 'barnes-maze', 'test53.mp4');
const CLIPS = ['test50', 'test51', 'test53'];
const REQUIRED_SHEETS = ['Results', 'Summary', 'Events', 'Parameters', 'OperationalDefinitions', 'Provenance'];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const results = {};

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

async function waitForAppReady(page) {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="trials-heading"]') != null,
    undefined,
    { timeout: 60_000 },
  );
}

function sheetRows(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

function eventSheetRows(wb) {
  const ws = wb.Sheets['Events'];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: null, range: 1 });
}

async function validateCommittedFiles() {
  for (const clip of CLIPS) {
    const summaryPath = join(OUTPUTS, `${clip}_summary.csv`);
    const eventsPath = join(OUTPUTS, `${clip}_events.csv`);
    const xlsxPath = join(OUTPUTS, `${clip}_report.xlsx`);
    const bundlePath = join(OUTPUTS, `${clip}.neurotrack.json`);

    await access(summaryPath);
    await access(eventsPath);
    await access(xlsxPath);
    await access(bundlePath);

    const summary = await readFile(summaryPath, 'utf8');
    const events = await readFile(eventsPath, 'utf8');
    results[`O_${clip}_summary_csv`] =
      summary.includes('totalLatency_valueKind') && summary.includes('fileName') ? 'PASS' : 'FAIL:headers';
    results[`O_${clip}_events_csv`] =
      events.includes('eventId') || events.includes('status') ? 'PASS' : 'FAIL:headers';

    const wb = XLSX.read(await readFile(xlsxPath), { type: 'buffer' });
    results[`O_${clip}_xlsx_sheets`] = REQUIRED_SHEETS.every((s) => wb.SheetNames.includes(s))
      ? 'PASS'
      : `FAIL:${wb.SheetNames.join(',')}`;

    const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
    results[`O_${clip}_bundle_schema`] =
      bundle.schemaVersion === '1.0.0' && bundle.bundleType === 'neurotrack-analysis' ? 'PASS' : 'FAIL';
  }

  await access(SESSION_BUNDLE);
  await access(join(OUTPUTS, 'README.md'));
  const session = JSON.parse(await readFile(SESSION_BUNDLE, 'utf8'));
  results.O_session_three_trials = session.trials?.length === 3 ? 'PASS' : `FAIL:${session.trials?.length}`;

  const wb53 = XLSX.read(await readFile(join(OUTPUTS, 'test53_report.xlsx')), { type: 'buffer' });
  const summary53 = sheetRows(wb53, 'Summary');
  const row53 = summary53.find((r) => String(r.fileName ?? '').includes('test53'));
  results.O_test53_summary_latency =
    row53?.totalLatency_value === 24.4 && row53?.totalLatency_valueKind === 'numeric' ? 'PASS' : `FAIL:${JSON.stringify({ v: row53?.totalLatency_value, k: row53?.totalLatency_valueKind })}`;

  results.O_test53_error_counts_unavailable =
    row53?.primaryErrorsConfirmed == null &&
    row53?.totalErrorsConfirmed == null &&
    row53?.primaryErrors_valueKind === 'unavailable'
      ? 'PASS'
      : `FAIL:${JSON.stringify({ primaryErrorsConfirmed: row53?.primaryErrorsConfirmed, totalErrorsConfirmed: row53?.totalErrorsConfirmed, kind: row53?.primaryErrors_valueKind })}`;

  const results53 = sheetRows(wb53, 'Results');
  const resultsRow53 = results53.find((r) => String(r.fileName ?? '').includes('test53'));
  results.O_test53_results_sheet =
    resultsRow53?.totalLatency && /24\.4/.test(String(resultsRow53.totalLatency)) ? 'PASS' : `FAIL:${JSON.stringify(resultsRow53?.totalLatency)}`;
  results.O_test53_results_errors_not_zero =
    resultsRow53?.primaryErrorsConfirmedCount &&
    !/^0$/.test(String(resultsRow53.primaryErrorsConfirmedCount)) &&
    String(resultsRow53.primaryErrorsConfirmedCount).includes('Target hole not confirmed')
      ? 'PASS'
      : `FAIL:${JSON.stringify(resultsRow53?.primaryErrorsConfirmedCount)}`;

  const events53 = eventSheetRows(wb53);
  const confirmedEscape = events53.filter(
    (r) => String(r.type ?? '').includes('escape') && String(r.status) === 'confirmed',
  );
  results.O_test53_confirmed_escape_row = confirmedEscape.length >= 1 ? 'PASS' : 'FAIL';
  results.O_test53_events_display_frames =
    events53.length > 0 &&
    events53.every(
      (r) =>
        r.startFrameDisplay === Number(r.startFrameIndex) + 1 &&
        r.endFrameDisplay === Number(r.endFrameIndex) + 1,
    )
      ? 'PASS'
      : 'FAIL';
  const proposedInvestigations = events53.filter(
    (r) => r.type === 'investigation' && r.status === 'proposed',
  );
  results.O_test53_investigation_provenance =
    proposedInvestigations.length === 4 && confirmedEscape.length === 1
      ? 'PASS'
      : `FAIL:proposed=${proposedInvestigations.length},confirmedEscape=${confirmedEscape.length}`;

  const wb51 = XLSX.read(await readFile(join(OUTPUTS, 'test51_report.xlsx')), { type: 'buffer' });
  const summary51 = sheetRows(wb51, 'Summary');
  const row51 = summary51.find((r) => String(r.fileName ?? '').includes('test51'));
  results.O_test51_censored_semantics =
    row51?.totalLatency_valueKind === 'censored' && row51?.totalLatency_value == null
      ? 'PASS'
      : `FAIL:${JSON.stringify({ k: row51?.totalLatency_valueKind, v: row51?.totalLatency_value })}`;

  const wb50 = XLSX.read(await readFile(join(OUTPUTS, 'test50_report.xlsx')), { type: 'buffer' });
  const summary50 = sheetRows(wb50, 'Summary');
  const row50 = summary50.find((r) => String(r.fileName ?? '').includes('test50'));
  results.O_test50_censored_semantics =
    row50?.totalLatency_valueKind === 'censored' && row50?.totalLatency_value == null
      ? 'PASS'
      : `FAIL:${JSON.stringify({ k: row50?.totalLatency_valueKind, v: row50?.totalLatency_value })}`;

  const eventCounts = {};
  for (const clip of CLIPS) {
    const bundle = JSON.parse(await readFile(join(OUTPUTS, `${clip}.neurotrack.json`), 'utf8'));
    const trial = bundle.trials[0]?.trial;
    eventCounts[clip] = trial?.events?.events?.length ?? 0;
  }
  const sessionCounts = {};
  for (const entry of session.trials) {
    const clip = CLIPS.find((c) => entry.trial.fileName.includes(c));
    if (clip) sessionCounts[clip] = entry.trial.events?.events?.length ?? 0;
  }
  results.O_event_counts_match_session =
    CLIPS.every((c) => eventCounts[c] === sessionCounts[c]) ? 'PASS' : `FAIL:${JSON.stringify({ eventCounts, sessionCounts })}`;
}

async function main() {
  if (!process.env.SKIP_GENERATE) {
    execSync('npm run generate:ms6-outputs', { cwd: ROOT, stdio: 'inherit' });
  }
  await validateCommittedFiles();

  if (!process.env.SKIP_BUILD) execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

  const server = await startStaticServer(DIST);
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.evaluate(async () => {
      await window.__ntResetSession?.();
      window.__ntResetInvokeCounts?.();
    });
    await page.reload();
    await waitForAppReady(page);

    results.O_load_example_button =
      (await page.locator('[data-testid="load-example-btn"]').count()) > 0 ? 'PASS' : 'FAIL';

    await page.locator('[data-testid="load-example-btn"]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="trials-heading"]')?.textContent?.includes('(3)'),
      undefined,
      { timeout: 30_000 },
    );
    results.O_load_example_three_trials = 'PASS';

    const invokeCounts = await page.evaluate(() => ({
      tracking: window.__ntGetTrackingInvokeCount?.() ?? -1,
      detect: window.__ntGetDetectEventsInvokeCount?.() ?? -1,
    }));
    results.O_no_tracking_on_load_example = invokeCounts.tracking === 0 ? 'PASS' : `FAIL:${invokeCounts.tracking}`;
    results.O_no_detect_on_load_example = invokeCounts.detect === 0 ? 'PASS' : `FAIL:${invokeCounts.detect}`;

    await page.getByRole('button', { name: /test53/i }).click();
    await page.waitForSelector('[data-testid="results-report"]', { timeout: 15_000 });
    await page.waitForSelector('[data-testid="trial-visualizations-panel"]', { timeout: 15_000 });
    results.O_reports_without_video = 'PASS';

    const latency = await page.locator('[data-testid="report-total-latency"]').textContent();
    results.O_test53_confirmed_latency_ui =
      latency && /24\.4\d s/.test(latency) && !latency.includes('Censored') ? 'PASS' : `FAIL:${latency?.trim()}`;

    const maxSpeed = await page.locator('[data-testid="report-max-speed"]').textContent();
    results.O_test53_gated_max_speed =
      maxSpeed && !/44162|43157/.test(maxSpeed) ? 'PASS' : `FAIL:${maxSpeed?.trim()}`;

    await page.getByRole('button', { name: /test51/i }).click();
    await page.waitForSelector('[data-testid="results-report"]', { timeout: 15_000 });
    const latency51 = await page.locator('[data-testid="report-total-latency"]').textContent();
    results.O_test51_uncertain_ui = latency51?.includes('Censored') ? 'PASS' : `FAIL:${latency51?.trim()}`;

    await page.evaluate(async () => {
      await window.__ntResetSession?.();
    });
    await page.reload();
    await waitForAppReady(page);
    await page.locator('[data-testid="import-bundle-empty-input"]').setInputFiles(SESSION_BUNDLE);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="trials-heading"]')?.textContent?.includes('(3)'),
      undefined,
      { timeout: 30_000 },
    );
    results.O_session_bundle_file_import = 'PASS';

    let hasVideo = false;
    try {
      await access(TEST53_MP4);
      hasVideo = true;
    } catch {
      results.O_video_relink = 'SKIP:no_mp4';
    }

    if (hasVideo) {
      await page.getByRole('button', { name: /test53/i }).click();
      const reselect = page.locator('[data-testid="reselect-video-btn"]');
      if ((await reselect.count()) > 0) {
        const chooserPromise = page.waitForEvent('filechooser');
        await reselect.click();
        const chooser = await chooserPromise;
        await chooser.setFiles(TEST53_MP4);
        await page.waitForSelector('[data-testid="review-view"]', { timeout: 120_000 });
        results.O_video_relink = 'PASS';
      } else {
        results.O_video_relink = 'SKIP:already_cached';
      }
    }

    await page.evaluate(async () => {
      await window.__ntResetSession?.();
    });
    await page.reload();
    await waitForAppReady(page);
    await page.locator('[data-testid="import-bundle-empty-input"]').setInputFiles(SESSION_BUNDLE);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="trials-heading"]')?.textContent?.includes('(3)'),
      undefined,
      { timeout: 30_000 },
    );
    await page.locator('[data-testid="import-bundle-ingest-input"]').setInputFiles(SESSION_BUNDLE);
    await page.waitForSelector('[data-testid="import-collision-dialog"]', { timeout: 10_000 });
    results.O_import_collision_dialog = 'PASS';
    await page.locator('[data-testid="import-collision-cancel-btn"]').click();
    const afterCancel = await page.locator('[data-testid="trials-heading"]').textContent();
    results.O_import_collision_cancel =
      afterCancel?.includes('(3)') ? 'PASS' : `FAIL:${afterCancel?.trim()}`;

    const hookCollision = await page.evaluate(async () => {
      const result = await window.__ntLoadExampleAnalysis?.();
      return result?.status ?? 'missing_hook';
    });
    results.O_load_example_hook_collision =
      hookCollision === 'collision' ? 'PASS' : `FAIL:${hookCollision}`;
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }

  const failures = Object.entries(results).filter(([, v]) => String(v).startsWith('FAIL'));
  console.log(JSON.stringify({ results }, null, 2));
  if (failures.length) {
    console.error('MS-6 outputs validation FAIL', failures);
    process.exit(1);
  }
  console.log('MS-6 outputs validation PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
