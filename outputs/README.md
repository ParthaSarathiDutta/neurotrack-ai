# NeuroTrack AI — analysis outputs

This directory contains reviewed reference artifacts and separate live browser exports from the recorded demonstration. All reports use the production serializers in `src/domain/export/`. Source video bytes are not included.

## Source recordings

The three sample MP4s, `test50.mp4`, `test51.mp4`, and `test53.mp4`, were provided by the [Salk Institute Center for AI and Research Computing](https://github.com/salk-airc/rse-takehome-2026/tree/main/data/barnes-maze). Download them from the original source and place them under `data/barnes-maze/` for regeneration or browser video re-linking. Reference annotations and complete protocol metadata are not provided.

## Reviewed reference analysis

| Item | Location |
|---|---|
| Source session fixture | `tests/fixtures/ms6/three-trial-session.neurotrack.json` |
| Load-example copy | `public/example/all-clips-session.neurotrack.json` |
| Published session bundle | `outputs/bundles/all-clips-session.neurotrack.json` |

Pipeline: ingest → calibration → trial window → tracking → event detection → scientist review → measurement and export. The reviewed session includes test53 candidate-hole completion confirmed at 24.40 s. Measures use the documented speed-validity definitions; regeneration does not require re-detecting the reviewed events.

Canonical export timestamp: **2026-09-07T20:19:04.008Z**. Tool version: `0.5.0-ms5`.

## Demo-recording exports

The [recorded workflow demonstration](https://www.youtube.com/watch?v=hbHXh1_zTKE) includes live CSV downloads from three independently processed browser sessions. These original exports are preserved in `outputs/demo-recording-2026-09-08/`, rather than being regenerated from the reference bundle.

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
| Canonical export timestamp | 2026-09-07T20:19:04.008Z |
| Tool version | 0.5.0-ms5 |
| Bundle schema | 1.0.0 (`neurotrack-analysis`) |
| Speed gating | speed_interval_validity.v1 |
| Gated speed definitions | mean_speed.v2, max_speed.v2 |
| Diagnostic speed definitions | mean_speed_diagnostic.v1, max_speed_diagnostic.v1 |

## Reproduce the reference reports

```bash
npm run generate:ms6-outputs
npm run validate:ms6-outputs
```

The source fixture must be present at `tests/fixtures/ms6/three-trial-session.neurotrack.json`. To rebuild that fixture from local MP4s through the full pipeline, the existing validation workflow provides:

```bash
WRITE_IMPORT_FIXTURE=1 node scripts/smoke-export-checkpoint1.mjs
npm run generate:ms6-outputs
```

The fixture-writing command intentionally replaces the local reference fixture; use it only when regeneration is intended. Preserve the published reviewed artifacts when experimenting with new tracking parameters or manual decisions.

## Load results in the application

Use **Load example analysis** in an empty session, or import `bundles/all-clips-session.neurotrack.json`. Reports and visualizations load without MP4 bytes. Re-select the matching source video when frame-accurate playback is needed; the application uses fingerprint-based re-linking.

For operational definitions and measurement conventions, see the Excel report worksheets and `reference/occupancy-time-accounting.md`, `reference/speed-interval-validity.md`, and `reference/occupancy-display-normalization.md` in the repository root.
