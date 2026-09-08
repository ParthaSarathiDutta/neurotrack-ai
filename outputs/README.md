# NeuroTrack AI — committed submission outputs (MS-6)

Generated from the approved three-trial analysis session using the production export
serializers in `src/domain/export/`. Video bytes are **not** included.

## Source videos

Sample MP4s: [Salk AIRC take-home sample data](https://github.com/salk-airc/rse-takehome-2026/tree/main/data/barnes-maze)
(`test50.mp4`, `test51.mp4`, `test53.mp4`). Place locally under `data/barnes-maze/` for
regeneration or MP4 re-link in the browser.

## Analysis source (canonical)

| Item | Location |
|------|----------|
| Session bundle (canonical) | `tests/fixtures/ms6/three-trial-session.neurotrack.json` |
| Load-example copy | `public/example/all-clips-session.neurotrack.json` |
| Committed session bundle | `outputs/bundles/all-clips-session.neurotrack.json` |

Pipeline: MS-1 ingest → calibration → trial window → tracking → MS-5 event detection →
scientist review (test53 `escape_completed` confirmed at 24.40 s). Measures recomputed
with `speed_interval_validity.v1` / `max_speed.v2` without re-detecting events.

Export timestamp for canonical artifacts: **2026-09-07T20:19:04.008Z** (`toolVersion` 0.5.0-ms5).

## Demo-recording exports (supplementary)

Browser exports from the **final submission demo recording** (~2026-09-08) live in
`outputs/demo-recording-2026-09-08/`. These are multi-section CSV reports (Summary, Events,
Parameters, OperationalDefinitions, Provenance) downloaded live during the demo — not regenerated
from the canonical bundle.

| File | Notes |
|------|-------|
| `test53_report.csv` | Confirmed candidate-hole completion **24.40 s**; 1 manual correction in demo session |
| `test51_report.csv` | Uncertain entry — censored ≥ **44.24 s** |
| `test50_report.csv` | Incomplete — censored ≥ **180.03 s** |

Scientific escape/censor semantics match the canonical outputs. Minor numeric differences
(path length, mean speed) reflect separate browser sessions and export timestamps, not
revised event detection. The canonical bundle and `outputs/test*_*.csv` / `*_report.xlsx`
remain the reviewed reference state for Load example analysis.

Local demo video (not committed): `submission-review-assets/final-demo.mp4` (~**3:07**).

## Tool and schema versions

| Field | Value |
|-------|-------|
| Export timestamp (canonical) | 2026-09-07T20:19:04.008Z |
| Tool version | 0.5.0-ms5 |
| Bundle schema | 1.0.0 (`neurotrack-analysis`) |
| Speed gating | speed_interval_validity.v1 |
| Gated speed defs | mean_speed.v2, max_speed.v2 |
| Diagnostic speed defs | mean_speed_diagnostic.v1, max_speed_diagnostic.v1 |

## Target hole and physical scale

All three trials: **protocol target unknown**, **px/cm unknown**. Summary exports mark
primary latency and quadrant measures unavailable — not zero.

## Review provenance (high level)

| Clip | Escape / latency | Events |
|------|------------------|--------|
| test53 | Confirmed completion — **24.40 s** total latency | 5 events (1 confirmed escape) |
| test51 | Candidate entry uncertain — censored ≥ 44.24 s | 10 proposed investigations |
| test50 | Incomplete censored — censored ≥ 180.03 s | 60 proposed investigations |

## Output inventory (canonical)

- test53_summary.csv, test53_events.csv, test53_report.xlsx, test53.neurotrack.json
- test51_summary.csv, test51_events.csv, test51_report.xlsx, test51.neurotrack.json
- test50_summary.csv, test50_events.csv, test50_report.xlsx, test50.neurotrack.json
- bundles/all-clips-session.neurotrack.json
- demo-recording-2026-09-08/test{50,51,53}_report.csv (demo session exports)
- README.md

## Regenerate canonical outputs

```bash
npm run generate:ms6-outputs
npm run validate:ms6-outputs
```

Requires the source bundle at `tests/fixtures/ms6/three-trial-session.neurotrack.json`.
To rebuild that bundle from local MP4s (full pipeline):

```bash
WRITE_IMPORT_FIXTURE=1 node scripts/smoke-export-checkpoint1.mjs
npm run generate:ms6-outputs
```

## Load in the app

Use **Load example analysis** on an empty session, or import `bundles/all-clips-session.neurotrack.json`.
Reports and visualizations work without MP4 bytes; re-select video via fingerprint when needed.

## Operational definitions

See the `OperationalDefinitions` worksheet in each `*_report.xlsx`, or
`reference/occupancy-time-accounting.md`, `reference/speed-interval-validity.md`,
`reference/occupancy-display-normalization.md`.
