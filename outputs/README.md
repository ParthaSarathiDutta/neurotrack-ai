# NeuroTrack AI — committed submission outputs (MS-6)

Generated from the approved three-trial analysis session using the production export
serializers in `src/domain/export/`. Video bytes are **not** included.

## Source videos

Sample MP4s: [Salk AIRC sample data](https://github.com/salk-software/airc-takehome/tree/main/data/barnes-maze)
(`test50.mp4`, `test51.mp4`, `test53.mp4`). Place locally under `data/barnes-maze/` for
regeneration or MP4 re-link in the browser.

## Analysis source

| Item | Location |
|------|----------|
| Session bundle (canonical) | `tests/fixtures/ms6/three-trial-session.neurotrack.json` |
| Load-example copy | `public/example/all-clips-session.neurotrack.json` |
| Committed session bundle | `outputs/bundles/all-clips-session.neurotrack.json` |

Pipeline: MS-1 ingest → calibration → trial window → tracking → MS-5 event detection →
scientist review (test53 `escape_completed` confirmed at 24.40 s). Measures recomputed
with `speed_interval_validity.v1` / `max_speed.v2` without re-detecting events.

## Tool and schema versions

| Field | Value |
|-------|-------|
| Export timestamp | 2026-09-07T20:08:18.622Z |
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

## Output inventory

- test53_summary.csv
- test53_events.csv
- test53_report.xlsx
- test53.neurotrack.json
- test51_summary.csv
- test51_events.csv
- test51_report.xlsx
- test51.neurotrack.json
- test50_summary.csv
- test50_events.csv
- test50_report.xlsx
- test50.neurotrack.json
- bundles/all-clips-session.neurotrack.json
- README.md

## Regenerate

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
