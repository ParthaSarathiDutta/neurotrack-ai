#!/usr/bin/env npx tsx
/**
 * Regenerate MS-6 published reference outputs from the approved three-trial
 * analysis bundle. Recomputes measures (speed_interval_validity.v1) without
 * re-detecting events or altering reviewed event statuses.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSingleTrialExportData } from '../src/domain/export/sessionExport';
import { buildSessionCsvFiles } from '../src/domain/export/csvExport';
import { buildSessionXlsxArrayBuffer, getXlsxSheetNames } from '../src/domain/export/xlsxExport';
import { buildNeuroTrackBundle, serializeNeuroTrackBundle } from '../src/domain/export/bundleExport';
import { parseNeuroTrackBundleJson } from '../src/domain/export/bundleSchema';
import { measuresFromAnalysis } from '../src/domain/measures/computeMeasures';
import { resolveMeasurementObservations } from '../src/domain/trajectory/measurementObservations';
import { TOOL_VERSION } from '../src/domain/trialFactory';
import type { AnalysisParams, NeuroTrackBundle, TrialRecord } from '../src/domain/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SOURCE_BUNDLE = join(ROOT, 'tests', 'fixtures', 'ms6', 'three-trial-session.neurotrack.json');
const OUTPUTS = join(ROOT, 'outputs');
const BUNDLES_DIR = join(OUTPUTS, 'bundles');
const PUBLIC_EXAMPLE = join(ROOT, 'public', 'example');
const FIXTURE_OUT = SOURCE_BUNDLE;

const EXPECTED_CLIPS = ['test50', 'test51', 'test53'] as const;

function clipPrefix(fileName: string): string {
  const match = fileName.match(/test\d+/i);
  return match ? match[0].toLowerCase() : fileName.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
}

function recomputeTrialMeasures(trial: TrialRecord, analysisParams: AnalysisParams): TrialRecord {
  if (!trial.events) return { ...trial, measures: null };
  const basis = trial.measurementBasis ?? analysisParams.measurementBasisDefault;
  const resolved = resolveMeasurementObservations(trial.track, basis);
  if (resolved.unavailable) return { ...trial, measures: null };
  const measures = measuresFromAnalysis(
    resolved.observations,
    trial.events,
    trial.geometry,
    trial.trialWindow,
    trial.timestampIndex,
  );
  return { ...trial, measures, updatedAt: new Date().toISOString() };
}

function assertSubmissionInvariants(trials: TrialRecord[]): void {
  const byClip = new Map<string, TrialRecord>();
  for (const trial of trials) {
    byClip.set(clipPrefix(trial.fileName), trial);
  }

  for (const clip of EXPECTED_CLIPS) {
    if (!byClip.has(clip)) {
      throw new Error(`Missing trial for ${clip} in source bundle`);
    }
  }

  const test53 = byClip.get('test53')!;
  const test51 = byClip.get('test51')!;
  const test50 = byClip.get('test50')!;

  const test53Escape = test53.events?.events?.find((e) => e.type === 'escape_completed');
  if (test53Escape?.status !== 'confirmed') {
    throw new Error('test53 escape_completed must remain scientist-confirmed in source bundle');
  }
  if (test53.measures?.totalLatency?.value == null || Math.abs(test53.measures.totalLatency.value - 24.4) > 0.01) {
    throw new Error(
      `test53 confirmed total latency must remain 24.40 s after recompute (got ${test53.measures?.totalLatency?.value})`,
    );
  }
  if (test53.measures?.maxSpeed?.definitionId !== 'max_speed.v2') {
    throw new Error('test53 measures must use max_speed.v2 after recompute');
  }
  if (test53.measures?.maxSpeedDiagnostic?.value == null) {
    throw new Error('test53 must retain maxSpeedDiagnostic after recompute');
  }

  if (!test51.measures?.totalLatency?.censored || test51.measures.totalLatency.flags?.includes('escape_entry_uncertain') !== true) {
    throw new Error('test51 must retain censored uncertain-entry semantics');
  }
  if (!test50.measures?.totalLatency?.censored) {
    throw new Error('test50 must retain censored incomplete semantics');
  }

  for (const trial of trials) {
    if (trial.geometry.targetHoleId != null) {
      throw new Error(`${trial.fileName}: protocol target must remain unknown (no invented target hole)`);
    }
    if (trial.geometry.pxPerCm != null) {
      throw new Error(`${trial.fileName}: physical scale must remain unknown (no invented pxPerCm)`);
    }
  }
}

function writeReadme(exportedAt: string): void {
  const readme = `# NeuroTrack AI — analysis outputs

This directory contains reviewed reference artifacts and separate live browser exports from the recorded demonstration. All reports use the production serializers in \`src/domain/export/\`. Source video bytes are not included.

## Source recordings

The three sample MP4s, \`test50.mp4\`, \`test51.mp4\`, and \`test53.mp4\`, were provided by the [Salk Institute Center for AI and Research Computing](https://github.com/salk-airc/rse-takehome-2026/tree/main/data/barnes-maze). Download them from the original source and place them under \`data/barnes-maze/\` for regeneration or browser video re-linking. Reference annotations and complete protocol metadata are not provided.

## Reviewed reference analysis

| Item | Location |
|---|---|
| Source session fixture | \`tests/fixtures/ms6/three-trial-session.neurotrack.json\` |
| Load-example copy | \`public/example/all-clips-session.neurotrack.json\` |
| Published session bundle | \`outputs/bundles/all-clips-session.neurotrack.json\` |

Pipeline: ingest → calibration → trial window → tracking → event detection → scientist review → measurement and export. The reviewed session includes test53 candidate-hole completion confirmed at 24.40 s. Measures use the documented speed-validity definitions; regeneration does not require re-detecting the reviewed events.

Canonical export timestamp: **${exportedAt}**. Tool version: \`${TOOL_VERSION}\`.

## Demo-recording exports

The [recorded workflow demonstration](https://www.youtube.com/watch?v=hbHXh1_zTKE) includes live CSV downloads from three independently processed browser sessions. These original exports are preserved in \`outputs/demo-recording-2026-09-08/\`, rather than being regenerated from the reference bundle.

| Recording | Report | Outcome |
|---|---|---|
| test50 | [test50_report.csv](demo-recording-2026-09-08/test50_report.csv) | Incomplete/censored; latency ≥180.03 s |
| test51 | [test51_report.csv](demo-recording-2026-09-08/test51_report.csv) | Uncertain entry; latency ≥44.24 s |
| test53 | [test53_report.csv](demo-recording-2026-09-08/test53_report.csv) | Confirmed candidate-hole completion, 24.40 s; one manual correction |

Each report contains Summary, Events, Parameters, OperationalDefinitions, and Provenance sections. The escape/censoring semantics match the reference analysis. Minor path-length and mean-speed differences reflect separate tracking sessions; test50 also has a one-frame investigation-boundary difference. The reviewed reference artifacts remain unchanged. Neither set of results should be overwritten merely to make the sessions numerically identical.

## Canonical output inventory

| Recording | Summary | Events | Excel workbook | Analysis bundle |
|---|---|---|---|---|
| test50 | [CSV](test50_summary.csv) | [CSV](test50_events.csv) | [XLSX](test50_report.xlsx) | [JSON](test50.neurotrack.json) |
| test51 | [CSV](test51_summary.csv) | [CSV](test51_events.csv) | [XLSX](test51_report.xlsx) | [JSON](test51.neurotrack.json) |
| test53 | [CSV](test53_summary.csv) | [CSV](test53_events.csv) | [XLSX](test53_report.xlsx) | [JSON](test53.neurotrack.json) |

Combined session: [all-clips-session.neurotrack.json](bundles/all-clips-session.neurotrack.json). The Excel workbooks contain Results, Summary, Events, Parameters, OperationalDefinitions, and Provenance worksheets.

## Scientific interpretation

| Recording | Escape / latency | Event summary |
|---|---|---|
| test53 | Confirmed candidate-hole completion; total latency 24.40 s | 5 events, including one confirmed escape |
| test51 | Candidate entry uncertain; censored ≥44.24 s | 10 events, including uncertain entry |
| test50 | Incomplete/censored; lower bound ≥180.03 s | 60 events, including incomplete entry |

The protocol target and physical scale are unknown for all three recordings. Target-dependent primary latency, error counts, and quadrant measures are unavailable, not zero. Distances and speeds remain in pixel units. A confirmed candidate-hole completion must not be interpreted as a verified protocol-target escape. Proposed events and censored outcomes retain their respective semantics.

The sample recordings have no ground-truth annotations. These reports are pipeline and scientist-review outputs, not independent accuracy validation against human raters.

## Tool and schema versions

| Field | Value |
|---|---|
| Canonical export timestamp | ${exportedAt} |
| Tool version | ${TOOL_VERSION} |
| Bundle schema | 1.0.0 (\`neurotrack-analysis\`) |
| Speed gating | speed_interval_validity.v1 |
| Gated speed definitions | mean_speed.v2, max_speed.v2 |
| Diagnostic speed definitions | mean_speed_diagnostic.v1, max_speed_diagnostic.v1 |

## Reproduce the reference reports

\`\`\`bash
npm run generate:ms6-outputs
npm run validate:ms6-outputs
\`\`\`

The source fixture must be present at \`tests/fixtures/ms6/three-trial-session.neurotrack.json\`. To rebuild that fixture from local MP4s through the full pipeline, the existing validation workflow provides:

\`\`\`bash
WRITE_IMPORT_FIXTURE=1 node scripts/smoke-export-checkpoint1.mjs
npm run generate:ms6-outputs
\`\`\`

The fixture-writing command intentionally replaces the local reference fixture; use it only when regeneration is intended. Preserve the published reviewed artifacts when experimenting with new tracking parameters or manual decisions.

## Load results in the application

Use **Load example analysis** in an empty session, or import \`bundles/all-clips-session.neurotrack.json\`. Reports and visualizations load without MP4 bytes. Re-select the matching source video when frame-accurate playback is needed; the application uses fingerprint-based re-linking.

For operational definitions and measurement conventions, see the Excel report worksheets and \`reference/occupancy-time-accounting.md\`, \`reference/speed-interval-validity.md\`, and \`reference/occupancy-display-normalization.md\` in the repository root.
`;

  writeFileSync(join(OUTPUTS, 'README.md'), readme, 'utf8');
}

async function main(): Promise<void> {
  const raw = readFileSync(SOURCE_BUNDLE, 'utf8');
  const parsed = parseNeuroTrackBundleJson(raw);
  if (!parsed.ok) {
    throw new Error(`Invalid source bundle: ${parsed.errors.map((e) => e.message).join('; ')}`);
  }

  const exportedAt = new Date().toISOString();
  const analysisParams: AnalysisParams = {
    ...parsed.bundle.analysisParams,
    toolVersion: TOOL_VERSION,
    updatedAt: exportedAt,
  };

  const trials: TrialRecord[] = parsed.bundle.trials.map((entry) =>
    recomputeTrialMeasures(entry.trial, analysisParams),
  );

  assertSubmissionInvariants(trials);

  const selectedTrialId =
    trials.find((t) => clipPrefix(t.fileName) === 'test53')?.id ?? parsed.bundle.selectedTrialId;

  const sessionBundle: NeuroTrackBundle = buildNeuroTrackBundle(
    trials,
    analysisParams,
    selectedTrialId,
    exportedAt,
  );

  mkdirSync(OUTPUTS, { recursive: true });
  mkdirSync(BUNDLES_DIR, { recursive: true });
  mkdirSync(PUBLIC_EXAMPLE, { recursive: true });

  const inventory: string[] = [];
  const requiredSheets = ['Results', 'Summary', 'Events', 'Parameters', 'OperationalDefinitions', 'Provenance'];

  for (const trial of trials) {
    const prefix = clipPrefix(trial.fileName);
    const exportData = buildSingleTrialExportData(trial, analysisParams, exportedAt);
    const csvFiles = buildSessionCsvFiles(exportData);

    const summaryPath = join(OUTPUTS, `${prefix}_summary.csv`);
    const eventsPath = join(OUTPUTS, `${prefix}_events.csv`);
    const xlsxPath = join(OUTPUTS, `${prefix}_report.xlsx`);
    const bundlePath = join(OUTPUTS, `${prefix}.neurotrack.json`);

    writeFileSync(summaryPath, csvFiles.summaryCsv, 'utf8');
    writeFileSync(eventsPath, csvFiles.eventsCsv, 'utf8');
    const xlsxBuffer = await buildSessionXlsxArrayBuffer(exportData);
    writeFileSync(xlsxPath, Buffer.from(xlsxBuffer));
    writeFileSync(
      bundlePath,
      serializeNeuroTrackBundle(buildNeuroTrackBundle([trial], analysisParams, trial.id, exportedAt)),
      'utf8',
    );

    const sheets = getXlsxSheetNames(xlsxBuffer);
    for (const sheet of requiredSheets) {
      if (!sheets.includes(sheet)) {
        throw new Error(`${prefix}_report.xlsx missing sheet ${sheet}`);
      }
    }

    inventory.push(
      `${prefix}_summary.csv`,
      `${prefix}_events.csv`,
      `${prefix}_report.xlsx`,
      `${prefix}.neurotrack.json`,
    );
  }

  const sessionBundlePath = join(BUNDLES_DIR, 'all-clips-session.neurotrack.json');
  const sessionJson = serializeNeuroTrackBundle(sessionBundle);
  writeFileSync(sessionBundlePath, sessionJson, 'utf8');
  copyFileSync(sessionBundlePath, join(PUBLIC_EXAMPLE, 'all-clips-session.neurotrack.json'));
  inventory.push('bundles/all-clips-session.neurotrack.json', 'README.md');

  writeReadme(exportedAt);

  // Keep test fixture aligned with recomputed measures for import regression tests.
  writeFileSync(FIXTURE_OUT, sessionJson, 'utf8');

  console.log('MS-6 outputs generated:');
  for (const item of inventory) {
    console.log(`  outputs/${item}`);
  }
  console.log('  public/example/all-clips-session.neurotrack.json');
  console.log(`  updated ${FIXTURE_OUT.replace(`${ROOT}/`, '')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
