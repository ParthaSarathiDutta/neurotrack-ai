# MS-6 — Visualization, Export & Reloadable Analysis

Branch: `ms-6-visualization-export-reload`
Constitution reference: `specs/constitution.md` → MS-6, Delivery requirements
Status: **📋 Plan — not started**

Depends on: MS-1–MS-5 merged at `cc6eaf3` (`main`, September 7, 2026).

---

## Inspection summary

Before writing this spec, the following were read and inspected:

- `specs/constitution.md` — MS-6 roadmap text, data-model contracts, delivery requirements (committed outputs, load example, `.neurotrack.json`)
- `specs/ms-1` through `specs/ms-5` — completed contracts, scope boundaries (MS-5 RF1/RF2 defer export and figures to MS-6)
- `reference/task-01-barnes-maze.md`, `reference/sample-data.md`, `reference/salk-assignment.md`
- `src/domain/types.ts` — `TrialRecord`, `Track`, `BehavioralEvent`, `MeasuresSnapshot`, `AnalysisParams`, provenance fields
- `src/domain/measures/computeMeasures.ts`, `src/domain/migration.ts`, `src/store/sessionStore.ts`
- `src/db/database.ts` — Dexie session + video blob stores; no export/import yet
- `src/components/EventsMeasuresPanel.tsx`, `ReviewView.tsx`, `VideoOverlay.tsx` — no export panel, no trajectory overlay, no charts
- `package.json` — no SheetJS or D3 installed; constitution names both as planned
- `scripts/validate-ms5.mjs` — Playwright cold-start pattern per clip; explicit `detectEvents`; no export tests
- Repository — **no** committed `outputs/`, **no** load-example seed, **no** `.neurotrack.json` samples

Key facts that shape MS-6:

1. **Domain data is complete for export.** `TrialRecord` already carries geometry, window, raw track + corrections + applied cleaning, events, measures, and per-trial `measurementBasis`. Export must serialize existing state — never re-run tracking or silent re-detection.
2. **Censored and unavailable measures are first-class.** `MeasureValue.censored`, `.unavailable`, `.lowerBound`, event `status`, and escape types must round-trip through spreadsheets and bundles without collapsing to bare numbers.
3. **Target hole and scale are often unknown.** Validation and committed outputs must not invent animal IDs, trial days, target holes, or `pxPerCm` to make columns look complete.
4. **Video bytes stay out of the bundle.** Fingerprint + metadata identify trials; user re-selects MP4 on import (same MS-1 re-identification path).
5. **No session metadata for learning curves.** Current `TrialRecord` has `fileName` and `label` only — no animal ID, cohort, or day fields. Per-animal learning views are **out of MVP scope** unless optional metadata is added later with explicit user approval.
6. **MS-5 escape review states must survive export.** Proposed `escape_completed` → censored total latency in export; confirmed → numeric latency. `escape_entry_uncertain` → explicit candidate-entry wording, not protocol-target escape.

---

## Mission (MS-6)

Deliver the **scientist-facing outputs** that make MS-1–MS-5 usable in a paper workflow:

- A readable **per-trial results report** in the app
- **Downloadable CSV and XLSX** (summary + events + parameters + definitions)
- A **versioned `.neurotrack.json` bundle** that reloads calibration, window, track, corrections, cleaning, events, measures, and review provenance **without re-tracking**
- **Essential visualizations** (trajectory, hole-visit timeline, occupancy) with time, hole numbering, uncertainty, and units
- **Committed generated outputs** for `test50`, `test51`, `test53` per Salk delivery requirements
- Focused **validation** proving export integrity and bundle round-trip equality

**Explicitly out of scope for MS-6:** cohort batch queue, new tracking models, MS-5 scientific/threshold changes, embedded MP4 in bundle, invented metadata, cohort comparison dashboards.

---

## Requirements

### A. Results report and spreadsheet export (priority 1)

| # | Requirement |
|---|---|
| RA1 | **Results report panel** per trial (and session summary when multiple trials loaded): measures, escape state, error counts (confirmed vs provisional), measurement basis, stale banners, and links to seek key frames. |
| RA2 | **CSV export** — at minimum three logical tables downloadable as separate files or a documented multi-section file: `trial_summary`, `events_detail`, `parameters_and_definitions`. |
| RA3 | **XLSX export** — same content as CSV in separate worksheets: `Summary`, `Events`, `Parameters`, `OperationalDefinitions`, `Provenance`. Opens in Excel without a legend. |
| RA4 | **Trial summary row** — one tidy row per trial: identifiers (`trialId`, `fileName`, `fingerprint`), window times, target status (`confirmed` / `unknown`), scale status (`pxPerCm` or `unknown`), measurement basis, all measures with explicit value semantics. |
| RA5 | **Events detail** — one row per event: type, hole (display number 1–20), frame/time span, `status`, `origin`, `confidence`, visit index, revisit flag, escape-specific fields (`entryOnsetTimeUs`, `completionTimeUs`, `censorBoundaryTimeUs`, body-entry path/version when present). |
| RA6 | **Parameters sheet** — flattened `AnalysisParams` (tracking, cleaning, events, operational definitions), `toolVersion`, export timestamp, bundle schema version when applicable. |
| RA7 | **Operational definitions** — each measure's `definitionId`, `definitionVersion`, `definitionLabel`, `definitionSummary`, and the session's selected variant (e.g. `first_target_investigation`, `neurotrack_body_entry` v3). |
| RA8 | **Provenance sheet** — per trial: track status, correction count, applied cleaning stale flag, event analysis stale flag, confirmed/rejected/proposed event counts, manual event count, strategy override if any. |
| RA9 | **Honest value encoding** — never emit a misleading numeric latency or error count for censored, unavailable, or unconfirmed results. Use explicit columns: `value`, `valueKind` (`numeric` \| `censored` \| `unavailable` \| `proposed`), `lowerBound`, `unit`, `flags`. |
| RA10 | **Target-unknown columns** — primary latency, errors, quadrant fields marked `unavailable` with reason; escape rows distinguish **candidate hole entry** vs **confirmed protocol-target escape** in text columns. |
| RA11 | **Scale-unknown columns** — path length and speed report px with flag when `pxPerCm` missing; do not silently convert to cm. |
| RA12 | Export is **read-only serialization** of current session state. **Must not** call `detectEvents`, re-track, mutate event status, or overwrite reviewed results. |
| RA13 | Session export when multiple trials loaded: one summary row per trial; events concatenated with `trialId` column. |
| RA14 | Keyboard-accessible export controls; `data-testid`s for Playwright. |

### B. Reloadable analysis bundle (priority 2)

| # | Requirement |
|---|---|
| RB1 | **File format:** `.neurotrack.json` — UTF-8 JSON, documented schema, semantic version in `schemaVersion`. |
| RB2 | **Bundle contents (per trial):** full `TrialRecord` except video bytes — `metadata`, `timestampIndex`, `trialWindow`, `geometry`, `track` (observations, manualCorrections, appliedCleaning, quality), `events`, `measures`, `measurementBasis`, fingerprint, fileName. |
| RB3 | **Session-level:** `analysisParams`, optional `selectedTrialId`, export metadata (`exportedAt`, `toolVersion`, `exporter: 'neurotrack-ai'`). |
| RB4 | **No embedded MP4.** Document size rationale (~5k observations × 3 clips would dominate; video stays external). |
| RB5 | **Video identity / relinking:** primary match on **content fingerprint**; secondary hint `fileName` + `metadata.nbSamples` + duration; on import, trials with missing cache enter `needs_reselect` and prompt user to pick matching file (reuse MS-1 path). |
| RB6 | **Import behavior:** validate schema → run `migrateTrialRecord` / `migrateAnalysisParams` → merge or replace trials (see D2) → **recompute measures only** via existing `computeMeasures` (no re-track, no re-detect unless events marked stale and user explicitly chooses re-detect). |
| RB7 | **Import errors** — structured, user-visible: unknown schema (reject), unsupported future schema (reject with version), corrupt JSON, missing required fields, trial count zero. Partial import forbidden — all-or-nothing per file. |
| RB8 | **Migration compatibility** — bundles from MS-5-era `toolVersion` import cleanly after `migration.ts`; stale v2 occlusion auto-completes remain migrated per MS-5 rules. |
| RB9 | **Round-trip equality** — export → import → displayed measures match pre-export for same basis (within floating-point tolerance documented in tests). Event `status`, manual corrections, and strategy override preserved bit-for-bit. |
| RB10 | Bundle export/import available from UI (Download analysis / Load analysis) and from validation hooks for automation. |
| RB11 | Document bundle schema in `reference/neurotrack-bundle-schema.md` (human-readable field glossary + example snippet). |

### C. Essential visualizations (priority 3)

| # | Requirement |
|---|---|
| RC1 | **Trajectory overlay** on review canvas (`VideoOverlay` or sibling layer): in-trial body path (basis-aware, default corrected), colored by **time** (sequential grayscale-safe palette) with optional **provenance** styling (manual vs auto vs interpolated segments visually distinct). |
| RC2 | Hole ring and target hole (when confirmed) shown; unconfirmed target not highlighted as protocol target. |
| RC3 | **Hole-visit timeline / raster** — time on x-axis, holes 1–20 on y-axis; investigation spans as bars or ticks; escape candidate/completion markers distinct from investigations; pre-trial and censor regions shaded. |
| RC4 | **Occupancy visualization** — 2D density or binned heat map on platform circle (grayscale-safe); time-weighted using container `timeUs`; legend with units (px or cm when scale known). |
| RC5 | All charts expose **time in seconds** from trial start (and absolute presentation time on hover/detail). |
| RC6 | **Uncertainty visible** — lost frames, absent-in-hole, interpolated segments, and stale cleaning/event banners reflected in charts (gaps, hatching, or legend entries — not silent connects across `lost`). |
| RC7 | Charts keyboard reachable; text alternatives or summary tables for screen readers where feasible (at minimum, report panel duplicates key numbers). |
| RC8 | **Path plot (standalone):** optional polish — trajectory overlay satisfies MVP if it includes time coloring and platform context. Separate Cartesian path plot deferred unless time permits in Phase 4b. |
| RC9 | **Learning curve / per-animal view:** **not in MVP** — no animal ID or day metadata in current model (see D5). Do not invent. |

### D. End-to-end demonstration (priority 4)

| # | Requirement |
|---|---|
| RD1 | Reproducible workflow documented in spec and README: ingest three clips → calibrate → window → track → detect events → (optional manual confirm on test53 escape) → view report → export CSV/XLSX → save bundle. |
| RD2 | **Committed outputs** under `outputs/` (see D3): for each of `test50`, `test51`, `test53`: `{clip}_summary.csv`, `{clip}_events.csv`, `{clip}_report.xlsx`, `{clip}.neurotrack.json`, plus `outputs/README.md` describing generation date, tool version, target/scale assumptions, and review state. |
| RD3 | Sample MP4 files **not** committed; `outputs/README.md` links to [Salk sample data](https://github.com/talmolab/salk-airc-takehome/tree/main/data/barnes-maze). |
| RD4 | **Load example** — UI action or documented one-click path that imports committed bundles for all three clips so evaluators see real computed output within ~60 s without running tracking (video re-select still required if blobs absent). |
| RD5 | Script `scripts/generate-demo-outputs.mjs` (or extend `validate-events-offline`) regenerates committed outputs when domain changes — run manually before release, not on every CI run (requires local videos). |

### E. Validation (priority 5)

| # | Requirement |
|---|---|
| RE1 | Unit tests for export serializers: censored/unavailable/proposed encoding, no numeric leak, target-unknown rows, scale-unknown units. |
| RE2 | Unit tests for bundle schema validate + round-trip measure equality + preserved confirmations/manual corrections. |
| RE3 | Unit tests: export does **not** invoke `detectEvents` or tracking (mock/spy). |
| RE4 | CSV/XLSX parse smoke tests (read back with Node or `xlsx` library; assert sheet names and row counts). |
| RE5 | Playwright `validate:ms6` on all three clips: report visible, download triggers, bundle export/import, reload persistence of confirmed escape on test53, visualizations render, MS-1–MS-5 regressions green. |
| RE6 | Bundle reload **without re-tracking**: import bundle → assert track observations unchanged (hash or length + sample frames) → measures match. |
| RE7 | Unknown-target export: primary latency column `unavailable`, not blank numeric zero. |
| RE8 | Unknown-scale export: path length unit `px` with flag, not fake cm. |

### F. Scope boundary

| # | Requirement |
|---|---|
| RF1 | No cohort batch queue or multi-folder automation. |
| RF2 | No new event detection algorithms or body-entry threshold changes. |
| RF3 | No per-filename branching in export, bundle, or visualization code. |
| RF4 | No PNG/PDF figure export in MVP (browser screenshot acceptable for demo video). |
| RF5 | No backend upload or cloud storage. |

---

## Approved decisions (proposed — pending review)

| ID | Decision | Rationale |
|---|---|---|
| **Q1** | Export encodes measure values with explicit `valueKind` column | Prevents Excel from treating "CENSORED" as text while hiding a numeric column elsewhere |
| **Q2** | Bundle is **session-shaped** (trials array + analysisParams); single-trial export = bundle with one trial | Matches Dexie session model; one import path |
| **Q3** | Import **merges by trialId** by default; user prompt if collision | Safer than blind replace; document "Replace session" advanced option if time permits |
| **Q4** | Trajectory overlay on existing review canvas satisfies "path plot" MVP | Avoid duplicate chart maintenance; constitution allows SVG/Canvas where simpler |
| **Q5** | Skip learning curve until optional trial metadata exists | Salk brief mentions it; inventing animal IDs violates scientific integrity rules |
| **Q6** | Use `xlsx` (SheetJS community) for XLSX | Constitution commitment; client-side, no server |
| **Q7** | Visualization: **SVG + Canvas** for overlay/heatmap; defer full D3 unless scales become painful | Smaller bundle; D3 optional in Phase 4b |
| **Q8** | Committed outputs generated with **target unknown**, test53 escape **confirmed in demo script** only for that clip's bundle | Matches MS-5 validation policy; document in `outputs/README.md` |

---

## Decisions

### D1 — Export module layout

```
src/domain/export/
  measureEncoding.ts    # MeasureValue → spreadsheet cells
  eventsTable.ts        # BehavioralEvent[] → rows
  trialSummary.ts       # TrialRecord → summary row
  csvExport.ts
  xlsxExport.ts
  bundleSchema.ts       # types + validateBundle()
  bundleExport.ts
  bundleImport.ts
  provenanceSummary.ts
```

Pure functions only; no React imports. Store/UI call export helpers and trigger browser download via `Blob` + `<a download>`.

### D2 — Bundle schema (v1.0.0 draft)

```typescript
interface NeuroTrackBundle {
  schemaVersion: '1.0.0';
  bundleType: 'neurotrack-analysis';
  exportedAt: string;           // ISO-8601
  toolVersion: string;            // from AnalysisParams
  analysisParams: AnalysisParams;
  trials: BundleTrialEntry[];
}

interface BundleTrialEntry {
  trial: TrialRecord;           // videoCached forced false on export
  videoIdentity: {
    fingerprint: string;
    fileName: string;
    durationSec: number | null;
    nbSamples: number | null;
    containerFrameRateLabel: string | null;
  };
  exportProvenance: {
    measurementBasis: MeasurementBasis;
    eventReviewCounts: { proposed: number; confirmed: number; rejected: number; manual: number };
    escapeState: string | null;  // human-readable summary for audit
    cleaningStale: boolean;
    eventsStale: boolean;
  };
}
```

Validation: JSON Schema or hand-rolled type guards in `bundleSchema.ts`; reject unknown major `schemaVersion`.

### D3 — Committed outputs layout

```
outputs/
  README.md
  test50_summary.csv
  test50_events.csv
  test50_report.xlsx
  test50.neurotrack.json
  test51_...
  test53_...
  bundles/
    all-clips-session.neurotrack.json   # optional: load-example single file
```

Filenames stable for Salk evaluators and CI smoke tests.

### D4 — Measure export encoding rules

| Condition | `value` column | `valueKind` | Notes |
|---|---|---|---|
| `unavailable` | empty | `unavailable` | `unavailableReason` column |
| `censored`, proposed escape | empty | `censored` or `proposed` | `lowerBound` when present; **no** `value` numeric |
| `censored`, confirmed escape | numeric | `numeric` | latency = completion − start |
| `value` present, not censored | numeric | `numeric` | |
| Strategy | classification string | `categorical` | override column if set |

### D5 — Learning curve exclusion

Current model has no `animalId`, `trialDay`, or cohort fields. **MVP excludes** session learning curve. If user approves later: add optional `TrialRecord.metadataTags?: Record<string, string>` — never auto-populate from filename.

### D6 — Export vs recompute on import

| Action | Allowed on import |
|---|---|
| Load track observations | yes (from bundle) |
| Load events/measures as stored | yes |
| `computeMeasures()` refresh | yes, **if** events present and user clicks "Refresh measures" OR measures null |
| `detectEvents()` | **only** explicit user action |
| Re-track | **never** from bundle import |

Default import: restore stored `measures` snapshot; offer "Recompute measures from events" button that uses existing pipeline without re-detect.

### D7 — UI placement

New **`ResultsExportPanel`** (or tab within review sidebar):

- Results report (HTML)
- Export buttons: CSV pack, XLSX, Bundle
- Import bundle button
- Visualization section below or adjacent (trajectory toggle, timeline, occupancy)

Trajectory overlay: toggle in `VideoOverlay` / player chrome (`Show trajectory`).

---

## Minimum viable delivery vs optional polish

### MVP (required for MS-6 complete)

| Feature | Notes |
|---|---|
| Per-trial results report | All measures currently in `MeasuresSnapshot` + error buckets + escape summary |
| CSV + XLSX export | Summary, events, parameters, definitions, provenance |
| `.neurotrack.json` export/import | Schema v1.0.0, fingerprint relink |
| Trajectory overlay | Time-colored, basis-aware, provenance-aware |
| Hole-visit timeline | 20 rows, investigation + escape markers |
| Occupancy heat map | Platform-binned, grayscale-safe |
| `outputs/` committed for 3 clips | Regenerated via script |
| Load example from bundles | Fast demo path |
| `validate:ms6` + unit tests | See Validation section |
| `reference/neurotrack-bundle-schema.md` | Documented IR |

### Optional (only if ahead of schedule)

| Feature | Defer if |
|---|---|
| Standalone Cartesian path plot | Trajectory overlay done |
| D3-based charts | SVG timeline sufficient |
| PNG/SVG figure download | Screenshot enough for submission |
| Session merge UI for bundle collisions | Single-session demo adequate |
| Multi-trial learning curve | No metadata model |
| Show max speed + quadrant in UI | Include in export even if UI unchanged |
| ZIP download of all CSVs | Separate downloads OK for MVP |

---

## Implementation phases

Sequential — each phase ends with tests passing; no MS-5 science changes.

### Phase 1 — Export domain layer (~1–2 days)

1. Add dependency `xlsx` (+ types if needed).
2. Implement `measureEncoding.ts`, `eventsTable.ts`, `trialSummary.ts`, `provenanceSummary.ts` per D4.
3. Implement `csvExport.ts`, `xlsxExport.ts` (multi-sheet).
4. Unit tests: U1–U8 (see Validation Tier 1).
5. Store method `exportTrialCsv/Xlsx` — **read-only**, no detect/track.

**Exit:** Unit tests green; manual spot-check one trial JSON fixture.

### Phase 2 — Results report UI (~1 day)

1. `ResultsExportPanel.tsx` — render report from `trial.measures`, events, escape copy (reuse `escapeStateSummary` logic or shared helper).
2. Download buttons wired to Phase 1 exporters.
3. Session-level "Export all trials" when multiple loaded.
4. `data-testid`s: `results-report`, `export-csv-btn`, `export-xlsx-btn`.

**Exit:** Playwright smoke: report visible after MS-5 flow; download produces non-empty files.

### Phase 3 — Analysis bundle (~2 days)

1. `bundleSchema.ts`, `bundleExport.ts`, `bundleImport.ts` per D2.
2. `reference/neurotrack-bundle-schema.md`.
3. UI: Download / Load `.neurotrack.json`; file picker; error toasts.
4. Import uses `migrateTrialRecord`; sets `needs_reselect` when video absent.
5. Unit tests: U9–U14; round-trip fixture.

**Exit:** Manual round-trip one trial; measures and event statuses identical.

### Phase 4 — Essential visualizations (~2–3 days)

**4a — Trajectory overlay**

1. `TrajectoryOverlay.tsx` — consumable observations for basis; segment by origin; grayscale time gradient.
2. Toggle control; respects trial window (exclude pre-trial).

**4b — Timeline + occupancy**

1. `HoleVisitTimeline.tsx` — SVG, 20 holes, investigation spans, escape markers.
2. `OccupancyHeatmap.tsx` — bin body positions in platform circle; time-weighted.
3. Grayscale print check documented in validation.

**Exit:** Charts render for test53 in browser; no filename branching.

### Phase 5 — Demo outputs & load example (~1 day)

1. `scripts/generate-demo-outputs.mjs` — full pipeline per clip (reuse offline validators where possible); writes `outputs/`.
2. `outputs/README.md` — provenance, target unknown, test53 confirm step noted.
3. Load example: import `outputs/bundles/all-clips-session.neurotrack.json` or three sequential imports.
4. Hook in ingest UI (`Load example analysis`).

**Exit:** Committed outputs in repo; load example reaches report without tracking.

### Phase 6 — Validation, docs, sign-off (~1–2 days)

1. `scripts/validate-ms6.mjs` — Tier 3 criteria.
2. `npm run validate:ms6` in package.json.
3. Update `AI_NOTES.md`, README (export section), constitution MS-6 status when complete.
4. Full pre-merge suite: lint, test, build, ms1–ms6.

**Exit:** All validation green; MS-6 merged to `main`.

**Estimated total effort:** 8–11 focused days (single developer), assuming MS-1–MS-5 remain stable.

---

## Validation

### Tier 1 — Unit tests (must pass)

| # | Case |
|---|---|
| U1 | Censored total latency → no numeric `value`; `valueKind=censored`; lower bound present. |
| U2 | Proposed `escape_completed` → `valueKind=proposed`; total latency not numeric. |
| U3 | Confirmed `escape_completed` → numeric total latency matches `computeMeasures`. |
| U4 | Target unknown → primary latency/errors/quadrant `unavailable` in summary row. |
| U5 | No `pxPerCm` → path length unit `px`; flag present. |
| U6 | Events detail includes `status`, `origin`, body-entry version for escape rows. |
| U7 | Export serializer never calls `detectEvents` / tracking (mock store). |
| U8 | XLSX has sheets: Summary, Events, Parameters, OperationalDefinitions, Provenance. |
| U9 | Bundle validate rejects malformed / wrong schemaVersion. |
| U10 | Bundle round-trip: event statuses, manual corrections, strategy override unchanged. |
| U11 | Bundle round-trip: `measures.totalLatency` equal within ε for confirmed escape fixture. |
| U12 | Import migrates MS-5 trial without data loss. |
| U13 | `escape_entry_uncertain` exports as candidate entry text, not "escaped". |
| U14 | Session export: N trials → N summary rows. |

### Tier 2 — Fixtures

| Fixture | Purpose |
|---|---|
| `tests/fixtures/ms6/export_censored_escape.json` | Proposed vs confirmed encoding |
| `tests/fixtures/ms6/export_unknown_target.json` | Unavailable columns |
| `tests/fixtures/ms6/bundle_roundtrip.json` | Full minimal trial + events + measures |
| `tests/fixtures/ms6/import_invalid_schema.json` | Reject path |

### Tier 3 — Playwright (`validate:ms6`)

| # | Criterion |
|---|---|
| V1 | After MS-5 flow, results report visible with measure definitions. |
| V2 | CSV download non-empty; contains `valueKind` column. |
| V3 | XLSX download opens (read back in script); Parameters sheet matches UI tool version. |
| V4 | Bundle download → clear session → import → measures match without track button press. |
| V5 | Import preserves manual correction (MS-4 fixture step or pre-seeded bundle). |
| V6 | test53: confirm escape → export → reload bundle → still confirmed + numeric latency. |
| V7 | Trajectory toggle shows path; timeline shows ≥1 investigation span when present. |
| V8 | Occupancy chart renders (canvas/SVG attached). |
| V9 | Unknown target: summary shows unavailable, not `0.00 s`. |
| V10 | Export click does not increment detect-events call count (hook counter). |
| V11 | MS-1–MS-5 regressions green. |

**Validation policy:** Same as MS-5 — no hard-coded target holes in domain code; test53 escape confirm may occur in test flow only.

### Tier 4 — Manual review

- Print/grayscale screenshot of trajectory + timeline + occupancy readable.
- Excel opened by human: no misleading latency numbers in sortable numeric columns without `valueKind`.
- Load example reaches results in <60 s on cold deploy.
- `outputs/README.md` accurately states assumptions.

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| SheetJS bundle size | Larger JS chunk | Dynamic import on export click; tree-shake |
| Large bundle JSON (test50 ~5.5k obs) | Slow download/import | Accept for MVP; document ~MB size; no pretty-print in production export |
| Export accidentally triggers re-detect | Corrupts reviewed science | Pure serializers + spy tests; code review gate |
| Trajectory overlay performance | Janky scrubbing | Decimate display points; full resolution in export chart only if needed |
| Load example without videos | Empty player | Clear `needs_reselect` UX; report/charts still populate from bundle |
| Committed outputs drift from code | Evaluator confusion | Regenerate script + note toolVersion in README; CI optional hash check |
| xlsx license ambiguity | Legal | Use community edition; document in README third-party notices |

---

## Decisions requiring your approval

Before implementation starts, please confirm or revise:

1. **Bundle import collision policy (Q3):** merge by `trialId` with prompt vs replace entire session default?
2. **Output directory name:** `outputs/` at repo root (proposed) vs `demo/outputs/`?
3. **Load example mechanism:** single session bundle vs three per-clip files vs IndexedDB seed script?
4. **test53 committed outputs:** include scientist-confirmed escape (numeric latency in export) or leave proposed/censored only?
5. **Trajectory overlay vs separate path plot:** is overlay-only acceptable for MVP (recommended)?
6. **Learning curve:** confirm exclusion until optional metadata fields exist?
7. **D3 dependency:** add only if Phase 4 SVG proves insufficient?

---

## References

- `specs/constitution.md` — MS-6, delivery requirements, data contracts
- `specs/ms-5-event-detection-behavioral-measures.md` — measures, censoring, export deferral RF1/RF2
- `reference/neurotrack-body-entry-v3.md` — escape export wording
- `reference/task-01-barnes-maze.md` — export and visualization brief
- `src/domain/types.ts` — source types for bundle

---

## Completion criteria (for future sign-off)

MS-6 is complete when:

1. Phases 1–6 implemented and merged to `main`.
2. Tier 1–3 validation PASS; Tier 4 manual review done.
3. `outputs/` contains CSV, XLSX, and `.neurotrack.json` for all three clips.
4. Load example works on deployed GitHub Pages URL.
5. Constitution MS-6 marked ✅; README updated with export/bundle instructions.
6. No MS-5 scientific regressions; no per-filename branching introduced.
