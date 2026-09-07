#!/usr/bin/env node
/**
 * Production GitHub Pages smoke test — load example, reports, and example bundle URL.
 * Usage: DEPLOY_URL=https://user.github.io/repo/ node scripts/validate-deploy.mjs
 */
import { chromium } from 'playwright';

const DEPLOY_URL = (process.env.DEPLOY_URL ?? 'https://parthasarathidutta.github.io/neurotrack-ai/').replace(
  /\/?$/,
  '/',
);
const results = {};

async function waitForAppReady(page) {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="trials-heading"]') != null,
    undefined,
    { timeout: 60_000 },
  );
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const indexResp = await page.goto(DEPLOY_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    results.D_index_status = indexResp?.status() === 200 ? 'PASS' : `FAIL:${indexResp?.status()}`;
    await waitForAppReady(page);

    const bundleResp = await page.request.get(`${DEPLOY_URL}example/all-clips-session.neurotrack.json`);
    results.D_example_bundle = bundleResp.ok() ? 'PASS' : `FAIL:${bundleResp.status()}`;

    await page.evaluate(async () => {
      await window.__ntResetSession?.();
      window.__ntResetInvokeCounts?.();
    });
    await page.reload();
    await waitForAppReady(page);

    results.D_load_example_button = (await page.locator('[data-testid="load-example-btn"]').count()) > 0 ? 'PASS' : 'FAIL';
    await page.locator('[data-testid="load-example-btn"]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="trials-heading"]')?.textContent?.includes('(3)'),
      undefined,
      { timeout: 30_000 },
    );
    results.D_load_example_three_trials = 'PASS';

    const invokeCounts = await page.evaluate(() => ({
      tracking: window.__ntGetTrackingInvokeCount?.() ?? -1,
      detect: window.__ntGetDetectEventsInvokeCount?.() ?? -1,
    }));
    results.D_no_tracking_on_load = invokeCounts.tracking === 0 ? 'PASS' : `FAIL:${invokeCounts.tracking}`;
    results.D_no_detect_on_load = invokeCounts.detect === 0 ? 'PASS' : `FAIL:${invokeCounts.detect}`;

    await page.getByRole('button', { name: /test53/i }).click();
    await page.waitForSelector('[data-testid="results-report"]', { timeout: 15_000 });
    await page.waitForSelector('[data-testid="trial-visualizations-panel"]', { timeout: 15_000 });
    results.D_reports_and_viz = 'PASS';

    const latency = await page.locator('[data-testid="report-total-latency"]').textContent();
    results.D_test53_latency =
      latency && /24\.4\d s/.test(latency) && !latency.includes('Censored') ? 'PASS' : `FAIL:${latency?.trim()}`;

    results.D_export_controls =
      (await page.locator('[data-testid="export-session-xlsx-btn"]').count()) > 0 &&
      (await page.locator('[data-testid="export-session-csv-btn"]').count()) > 0
        ? 'PASS'
        : 'FAIL';
  } finally {
    await browser.close();
  }

  const failures = Object.entries(results).filter(([, v]) => String(v).startsWith('FAIL'));
  console.log(JSON.stringify({ deployUrl: DEPLOY_URL, results }, null, 2));
  if (failures.length) {
    console.error('Deploy validation FAIL', failures);
    process.exit(1);
  }
  console.log('Deploy validation PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
