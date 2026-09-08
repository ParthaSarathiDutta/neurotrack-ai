# NeuroTrack AI

**Browser-based computer vision and behavioral analysis for Barnes maze experiments.**

[**Live application**](https://parthasarathidutta.github.io/neurotrack-ai/) · [**Watch the demo**](https://www.youtube.com/watch?v=hbHXh1_zTKE) · [**Analysis outputs**](outputs/) · [**Source code**](src/)

For the clearest view of the interface, select **1080p** in YouTube's Quality settings.

NeuroTrack AI transforms overhead behavioral recordings into reviewable trajectories, hole-investigation events, scientific measurements, visualizations, and spreadsheet-ready reports. It combines automated computer vision with scientist-in-the-loop review so that tracking failures, uncertain events, and missing protocol information remain visible rather than being silently converted into measurements.

The application runs locally in the browser without an account, GPU, backend, or installation for end users. It is designed for researchers and core-facility staff who need a reproducible workflow from raw video to analysis results. Developed by Partha Sarathi Dutta using TypeScript, React, WebCodecs, browser workers, and local persistence.

## Try the application

### Explore the saved example

1. Open the [live application](https://parthasarathidutta.github.io/neurotrack-ai/).
2. Select **Load example analysis** to restore the three pre-analyzed recordings: test50, test51, and test53.
3. Select a trial, inspect **Results & export** and **Visualizations**, and download a CSV, Excel workbook, or portable analysis bundle.

This path loads actual saved analysis data without requiring the source MP4s or rerunning tracking. The results and charts are available immediately after import; video playback requires re-linking the matching source file.

### Run the full pipeline

1. **Ingest:** Import one or more MP4s by drag-and-drop or folder selection. Sessions persist in browser IndexedDB.
2. **Calibrate:** Automatically detect the platform and 20-hole geometry, inspect confidence, and manually adjust regions when necessary. Supply the protocol target and physical diameter when known.
3. **Define the trial window:** Review motion onset and trial end, with an optional protocol cutoff.
4. **Track:** Run CPU-based background-subtraction tracking with body/nose estimates, progress, and quality diagnostics.
5. **Correct and clean:** Review video frames, make manual body/nose corrections, and preview or apply trajectory cleaning with preserved raw observations and provenance.
6. **Detect and review events:** Identify hole investigations and candidate escape outcomes, adjust thresholds, and confirm or reject proposed events.
7. **Analyze and export:** Inspect trajectories, hole-visit timelines, occupancy heatmaps, and behavioral measures. Export CSV/XLSX reports or a reloadable `.neurotrack.json` bundle.

Automated results are not presented as ground truth. Raw observations, manual corrections, cleaning operations, and event-review decisions remain distinguishable. A correction to upstream tracking can invalidate downstream cleaning or events, which must then be explicitly reviewed or recomputed.

## Demo and results

The [full workflow demonstration](https://www.youtube.com/watch?v=hbHXh1_zTKE) shows the application processing all three sample recordings, reviewing and correcting tracking, inspecting events, and exporting results. The same application is available through the live deployment above.

### Published analysis artifacts

The repository includes both a reviewed reference analysis and the actual CSV exports downloaded during the recorded demonstration. They are intentionally kept separate: the reference outputs are not overwritten to make independently generated sessions agree.

| Recording | Reviewed outcome | Demo CSV | Excel report |
|---|---|---|---|
| test50 | Incomplete/censored; latency ≥180.03 s | [Download report](outputs/demo-recording-2026-09-08/test50_report.csv) | [Download XLSX](outputs/test50_report.xlsx) |
| test51 | Uncertain entry; latency ≥44.24 s | [Download report](outputs/demo-recording-2026-09-08/test51_report.csv) | [Download XLSX](outputs/test51_report.xlsx) |
| test53 | Confirmed candidate-hole completion; total latency 24.40 s | [Download report](outputs/demo-recording-2026-09-08/test53_report.csv) | [Download XLSX](outputs/test53_report.xlsx) |

The three demo CSVs contain Summary, Events, Parameters, OperationalDefinitions, and Provenance sections. The canonical artifacts additionally include separate summary/event CSVs, six-sheet Excel workbooks, per-trial JSON bundles, and a combined session bundle. See the [complete output inventory and provenance](outputs/README.md).

The protocol target is unknown for all three sample clips. Consequently, target-dependent primary latency, error counts, and quadrant measures are unavailable—not zero. The confirmed test53 completion is a candidate-hole completion, not a verified protocol-target escape. Physical scale is also unknown, so distance and speed remain in pixels and pixels/second. These distinctions are part of the exported data.

## Architecture and engineering

| Layer | Implementation |
|---|---|
| Frontend | React, TypeScript, Vite; static GitHub Pages deployment |
| Video processing | WebCodecs and mp4box.js with worker-based decoding and tracking |
| Persistence | Dexie/IndexedDB, content fingerprints, and portable JSON analysis bundles |
| Calibration and tracking | Geometric platform/hole detection, background subtraction, body/nose tracking, confidence and failure diagnostics |
| Scientific analysis | Basis-aware trajectory cleaning, event detection, censored outcomes, speed-validity rules, and provenance-aware measures |
| Visualization and export | Trajectory overlay, hole-visit timeline, occupancy heatmap, CSV/XLSX reports |
| Engineering validation | Unit tests, Playwright browser checks, GitHub Actions CI, and deployment smoke tests |

The pipeline separates immutable raw observations from corrected and cleaned trajectories. Manual edits take precedence over automated estimates, and an unavailable nose position is not fabricated. Event detection distinguishes investigations from escape outcomes and preserves proposed, confirmed, and rejected decisions. The measurement layer records operational definitions and retains diagnostic values separately from quality-gated primary measures.

Architecture decisions and implementation history are documented in [specs/constitution.md](specs/constitution.md), [AI_NOTES.md](AI_NOTES.md), and the [detailed engineering archive](reference/ai-notes-archive.md). The [technical walkthrough](reference/demo-checklist.md) provides a reproducible path through the application.

## Restore an analysis without re-tracking

**Load example analysis** imports `public/example/all-clips-session.neurotrack.json`. To restore your own work, import a `.neurotrack.json` bundle from the empty-session screen or **Results & export**. Calibration, observations, events, measures, and reports reload without re-running the pipeline. Re-select the matching MP4 when frame-accurate playback is needed; the application uses its content fingerprint to re-link the video.

Portable bundles deliberately exclude video bytes. Keep the original recordings separately, and review any import-collision confirmation before replacing an existing session.

## Source data and attribution

The three demonstration recordings are `test50.mp4`, `test51.mp4`, and `test53.mp4`, provided by the [Salk Institute Center for AI and Research Computing](https://github.com/salk-airc/rse-takehome-2026/tree/main/data/barnes-maze) for its Research Software Engineer exercise. NeuroTrack AI originated from that exercise and is maintained here as a standalone research-software and engineering portfolio project. The original requirements and source-data documentation are retained in the repository for traceability; they are not the project README.

The sample MP4s are not committed. Download them from the linked source and place them in `data/barnes-maze/` for local development or full-pipeline validation, or select them directly through the browser interface. See [reference/sample-data.md](reference/sample-data.md) for frame rates and known clip-specific difficulties. The source recordings do not include reference annotations or complete protocol metadata.

## Developer setup

Requires **Node.js 22** (CI pin) and Chromium for the Playwright validators. Dependencies are pinned through `package-lock.json`.

```bash
git clone https://github.com/ParthaSarathiDutta/neurotrack-ai.git
cd neurotrack-ai
npm ci
npm run dev
```

Open the local URL printed by Vite. To run the standard checks:

```bash
npm run lint
npm test
npm run build
```

### Validation suite

After building, run the relevant browser and scientific validation scripts:

```bash
npm run validate:calibration
npm run validate:ms1
npm run validate:ms2
npm run validate:ms3
npm run validate:tracking
npm run validate:ms4
npm run validate:ms5
npm run validate:import-empty
npm run validate:ms6
npm run validate:deploy
```

`validate:ms6` consolidates visualization and output-integrity checks. The final implementation was validated with 230 passing unit tests and the production deployment smoke checks. The CI workflow executes lint, tests, and build on pushes, with deployment from `main` to GitHub Pages.

### Reproduce the reference outputs

The reviewed source fixture is `tests/fixtures/ms6/three-trial-session.neurotrack.json`. The following commands regenerate its canonical reports using the production serializers:

```bash
npm run generate:ms6-outputs
npm run validate:ms6-outputs
```

The full pipeline can also be run against the local source MP4s. Do not overwrite the reviewed fixture or canonical outputs when experimenting with new tracking parameters or manual decisions. See [outputs/README.md](outputs/README.md) for the exact artifact provenance and regeneration procedure.

## Known limitations

### Scientific and protocol limitations

- **No ground-truth accuracy benchmark:** The provided clips have no reference scoring. Reported outcomes are pipeline and review results, not independently validated behavioral annotations or publishable accuracy claims. Independent rater comparison is required before treating the system as validated for a new experimental protocol.
- **Unknown protocol target:** Target-dependent primary latency, error counts, and quadrant measures remain unavailable until the actual target hole is supplied. A candidate entry or disappearance is not automatically a successful escape.
- **Unknown physical scale:** Distance and speed are reported in pixel units until a verified platform diameter is provided. Geometry alone does not establish centimeters.
- **Censored outcomes:** An incomplete or uncertain trial retains a lower-bound latency rather than an invented completion time. Proposed events are not silently promoted to confirmed events.
- **Search strategy:** `heuristic_v1` is a documented heuristic classifier with manual override, not a reproduction of a single published strategy-classification method.
- **Timestamp quality:** Some source MP4s contain duplicate or compressed presentation timestamps. Primary speed measures use documented interval-validity gating; diagnostic ungated speeds are retained for audit. See [speed interval validity](reference/speed-interval-validity.md).

### Clip-specific behavior and operational constraints

- test51 has an off-center platform and start cylinder that require careful calibration review and may trigger low-confidence acknowledgment. Unusual apparatus geometry or lighting can require manual hole adjustment.
- On-platform occupancy time can be shorter than trial duration when the animal leaves the platform; this is documented for test51 in [occupancy time accounting](reference/occupancy-time-accounting.md).
- Tracking and detection are CPU/browser-based and have not been benchmarked against every camera, lighting condition, or laboratory apparatus. Browser memory, supported codecs, and device performance constrain the size and speed of processing.

### Deliberate scope exclusions

The current application is single-user and browser-local. It does not include server-side cohort management, a batch processing queue, cross-session learning curves, inter-rater comparison tools, or model-assisted retraining. Portable bundles do not embed source videos. These are deliberate scope boundaries rather than claims that the features have been implemented.

## Data handling

Video decoding, tracking, event detection, and export run entirely in the browser. User recordings and analysis state are stored locally through IndexedDB, subject to browser storage limits and the bounded video cache. No user video or analysis data is automatically uploaded to an application backend, telemetry service, or third-party vision API. The user controls any subsequent sharing of downloaded reports, bundles, or original recordings. This local-first design helps keep protocol-sensitive research data on the user's machine, but users remain responsible for their institution's data-handling requirements and local device security.

## Keys and cost

No API keys or paid model services are required. The bundled example analysis provides a credential-free path to reports and visualizations even without source MP4s. Analysis compute runs on the user's device, so the application incurs no per-video hosted inference charge. The current public deployment uses GitHub Pages for static assets; any organizational hosting, storage, maintenance, and device costs depend on the chosen deployment environment. No paid infrastructure or hosted inference is required by the current architecture.

## Accessibility and deployment

The interface includes labeled controls, keyboard navigation, visible focus indicators, and status information that is not conveyed by color alone. Layout is designed for usability at 200% browser zoom; browser validation includes keyboard-reachability checks. Numeric results are also available through the Results panel alongside charts. Accessibility support should continue to be tested with target devices and assistive technologies.

GitHub Actions in `.github/workflows/ci.yml` runs lint, tests, and build, and deploys `main` to GitHub Pages at `/neurotrack-ai/`. The live application can be checked with `npm run validate:deploy` after deployment.

## License

MIT — see [LICENSE](LICENSE).
