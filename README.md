# NeuroTrack AI

**Live app:** https://parthasarathidutta.github.io/neurotrack-ai/  
**Demo video:** https://www.youtube.com/watch?v=hbHXh1_zTKE (~3:07)  
**Repository:** https://github.com/ParthaSarathiDutta/neurotrack-ai

Browser-based Barnes maze analysis for Salk AIRC Task 1. NeuroTrack AI turns overhead maze videos into reviewable trajectories, hole-visit events, behavioral measures, and Excel-ready exports — without a terminal, install, or account. It is built for core-facility staff and graduate students who run cohorts a few times a year and need defensible numbers, visible thresholds, and manual override when tracking fails.

Architecture and milestone specs: `specs/constitution.md`. Evaluator walkthrough: `reference/demo-checklist.md`.

---

## Quick start (evaluators)

1. Open the [live app](https://parthasarathidutta.github.io/neurotrack-ai/) — no install or account.
2. Click **Load example analysis** to import three pre-analyzed trials (test50, test51, test53).
3. Select a trial → review **Results & export**, **Visualizations**, and download CSV/XLSX or a `.neurotrack.json` bundle.

Within about one minute you should see real reports and charts. No MP4 files are required for this path.

**Saved example outcomes** (protocol target unknown on all clips):

| Clip | Escape / total latency | Notes |
|------|------------------------|-------|
| test53 | **24.40 s** numeric total latency | Candidate-hole completion confirmed; not protocol-target escape |
| test51 | Censored ≥ **44.24 s** | Uncertain hole entry — not confirmed escape |
| test50 | Censored ≥ **180.03 s** | Incomplete trial at recording end |

Primary latency, error counts, and quadrant measures show **Unavailable** (not zero) because the protocol target hole was never confirmed.

---

## Full workflow with sample videos

Sample MP4s are **not** bundled in this repo. Download from the authoritative Salk take-home data:

https://github.com/salk-airc/rse-takehome-2026/tree/main/data/barnes-maze

Place `test50.mp4`, `test51.mp4`, and `test53.mp4` under `data/barnes-maze/` (see `reference/sample-data.md` for frame rates and known difficulties).

Typical scientist workflow:

1. **Ingest** — drag-and-drop or folder import; session persists in IndexedDB across refresh.
2. **Calibrate** — auto-detect 20 holes; confirm or nudge; optionally confirm target hole if known.
3. **Trial window** — review motion onset (~5 s) and trial end; optional protocol cutoff.
4. **Track** — background-subtraction tracker with progress and quality summary.
5. **Correct & clean** — frame-accurate body/nose edits; preview/apply trajectory cleaning with provenance.
6. **Detect events** — hole investigations and escape semantics with adjustable thresholds.
7. **Review & export** — confirm or reject proposed events; download CSV/XLSX or portable `.neurotrack.json`.

---

## Restore analysis without re-tracking

**Load example analysis** imports `public/example/all-clips-session.neurotrack.json`.

To restore your own work:

1. Import a `.neurotrack.json` bundle (empty session panel or Results & export).
2. Reports, events, measures, and calibration reload immediately — no re-tracking or re-detection.
3. Re-select the matching MP4 when video playback is needed (fingerprint-based re-link).

Portable bundles exclude video bytes by design.

---

## Developer setup (cold clone)

Requires **Node.js 22** (CI pin) and **Chromium** (Playwright validators). Dependencies are pinned via `package-lock.json`.

```bash
git clone https://github.com/ParthaSarathiDutta/neurotrack-ai.git
cd neurotrack-ai
npm ci
npm run dev          # http://localhost:5173/neurotrack-ai/
npm run lint
npm test             # 230 unit tests
npm run build
```

### Validation suite

Run after `npm run build` for Playwright scripts:

```bash
npm run validate:calibration
npm run validate:ms1
npm run validate:ms2
npm run validate:ms3
npm run validate:tracking
npm run validate:ms4
npm run validate:ms5
npm run validate:import-empty
npm run validate:ms6          # viz + output integrity
npm run validate:deploy       # production GitHub Pages smoke test
```

Consolidated MS-6 check: `npm run validate:ms6`.

Regenerate committed canonical outputs from the reviewed fixture:

```bash
npm run generate:ms6-outputs
npm run validate:ms6-outputs
```

---

## Output inventory and provenance

Pre-generated artifacts live in `outputs/` — see `outputs/README.md` for full provenance.

| Artifact | Description |
|----------|-------------|
| `test{50,51,53}_summary.csv` | Machine-readable trial summary |
| `test{50,51,53}_events.csv` | Per-event detail |
| `test{50,51,53}_report.xlsx` | Six-sheet workbook (Results, Summary, Events, Parameters, OperationalDefinitions, Provenance) |
| `test{50,51,53}.neurotrack.json` | Per-clip analysis bundles |
| `bundles/all-clips-session.neurotrack.json` | Three-trial session bundle |
| `demo-recording-2026-09-08/test*_report.csv` | Live browser exports from the final demo recording (supplementary) |
| `public/example/all-clips-session.neurotrack.json` | Served by GitHub Pages for Load example |

**Canonical source:** `tests/fixtures/ms6/three-trial-session.neurotrack.json` (reviewed pipeline run; test53 escape confirmed at 24.40 s). Demo-recording CSVs are preserved separately and match the same escape/censor semantics with minor session-level numeric drift.

No `.mp4` files are committed.

---

## Demo video

A final screen recording demonstrates all three sample videos analyzed end-to-end in the browser.

| Item | Status |
|------|--------|
| Hosted video | [YouTube — NeuroTrack AI demo](https://www.youtube.com/watch?v=hbHXh1_zTKE) (1080p, ~**3:07**) |
| Local file | `submission-review-assets/final-demo.mp4` (not committed; same recording) |
| Hosted URL | **Resolved** — linked at top of README |

The assignment asks for a 2–3 minute video. The final recording is approximately **3:07** (~7 seconds over the upper bound). It was not shortened or edited to fit the limit.

---

## Known limitations

### Scientific / protocol

- **Protocol target unknown** on all three sample clips — primary latency, error counts, and quadrant measures export as **unavailable**, never as misleading zeros.
- **Physical scale unknown** — path length and speeds report in **px** unless the user supplies px/cm calibration.
- **Escape semantics** — test53 has confirmed *candidate-hole* completion (24.40 s); test51 uncertain entry (censored); test50 incomplete (censored). Proposed auto events remain visually distinct from confirmed ones.
- **No ground truth** — sample videos have no reference scoring; numbers are defensible pipeline outputs, not validated against human raters.
- **Search strategy** — heuristic classifier (`heuristic_v1`) with manual override; not tied to a single published method.
- **Speed reporting** — primary mean/max use `speed_interval_validity.v1` / v2 definitions; diagnostic speeds retain ungated intervals for audit (`reference/speed-interval-validity.md`).
- **Timestamp quirks** — duplicate container timestamps and sub-millisecond intervals can inflate diagnostic max speed; gated v2 speeds exclude compression intervals.

### Deliberate scope exclusions

- Single-user, browser-local; no cohort batch queue or server-side storage.
- No embedded video in portable bundles.
- No cross-session learning curves, inter-rater comparison, or model-assisted retraining.
- Tasks 2 and 3 (colony manager, AlphaFold front end) intentionally out of scope.

### Known defects / clip-specific behavior

- **test51 calibration** — off-center platform and start cylinder require low-confidence acknowledgment; ring-fit uses geometric circle fit (not centroid averaging).
- **Hole detection** — generalizes across lighting/position but may need manual nudge on unusual rigs.
- **Occupancy time** — on-platform time can be less than trial duration when the mouse leaves the platform (documented for test51 in `reference/occupancy-time-accounting.md`).

---

## Data handling

All video decoding, tracking, event detection, and export run **entirely in the browser**. Video bytes stay on the user's machine in IndexedDB (bounded cache) unless the user explicitly downloads an export or uploads a bundle file elsewhere. There is **no backend**, **no telemetry**, and **no third-party vision API** — the design choice keeps IACUC-sensitive recordings local by default. GitHub Pages serves only the static app shell and the committed example JSON bundle; user analyses are never uploaded automatically.

---

## Keys and cost

**No API keys are required.** The app degrades gracefully without any credentials: evaluators can use **Load example analysis** for a full demo path with reports, charts, and exports. Local development and validation use open-source dependencies only (npm packages, Playwright). Representative cost for the Institute at scale: **$0** for analysis compute (client-side); optional GitHub Pages hosting for the static deployment only.

---

## Deployment

GitHub Actions (`.github/workflows/ci.yml`) runs lint, test, and build on push; **main** deploys to GitHub Pages at `/neurotrack-ai/`. Verify after deploy:

```bash
npm run validate:deploy
```

---

## Accessibility

Keyboard navigation, visible focus, labeled controls, and non-color-only status encoding are built into the UI. Validation scripts include keyboard-reachability checks (`validate:ms2` V14). Layout uses design tokens intended to remain usable at **200% browser zoom**. Key numeric results are duplicated in the Results report panel for screen-reader access alongside charts.

---

## License

MIT — see [LICENSE](LICENSE).
