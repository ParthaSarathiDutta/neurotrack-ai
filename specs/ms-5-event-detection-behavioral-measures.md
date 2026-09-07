# MS-5 — Event Detection & Behavioral Measures

Branch: `ms-5-event-detection-behavioral-measures`
Base: `main` @ `e3ef219` (MS-4 complete)
Constitution reference: `specs/constitution.md` → MS-5
Status: **Implementation in progress** (approved plan + consistency clarifications)

**Revision:** `b8cc1e7` → `2d12b75` (scientific review) → implementation branch.

### Final consistency clarifications (pre-implementation)

1. **Follow-up lower bound (all right-censored trials):** For any trial without observed completion, `observedFollowUpLowerBoundUs = censorBoundaryTimeUs − trialStartTimeUs` — including `trial_censored_no_entry`. Entry evidence (`entryOnsetTimeUs`) and censor reason remain separate fields; lower bound reflects observed trial duration, not inferred entry.
2. **Measurement basis change:** Changing basis **re-detects** dependent automatic events and **recomputes** measures on the new trajectory. Manual reviews preserved per D9 merge rules; `EventAnalysis.basisUsed` recorded.
3. **Status vs confidence:** `status` and `confidence` are orthogonal. **`status === 'confirmed'` counts in finalized measures regardless of `confidence`**. Only `status === 'proposed'` or `status === 'rejected'` exclude from confirmed counts (rejected never counts).
4. **Incomplete pixel evidence:** `pixel_evidence_incomplete` downgrades confidence only — never forces `trial_censored_no_entry` or definitive “no entry” when Phase A is ambiguous.

---

## Inspection summary

Before writing this spec, the following were read and inspected:

- `specs/constitution.md` (sample-data findings #3–#4, data-model contracts, MS-5 roadmap text, validation gates)
- `specs/ms-3-tracking-quality-assessment.md`, `specs/ms-4-manual-correction-trajectory-cleaning.md` (completed contracts and scope boundaries)
- `reference/task-01-barnes-maze.md`, `reference/sample-data.md`
- `src/domain/types.ts` — `Observation`, `Track`, `Geometry`, `TrialWindow`; **no `Event` or `Measures` types yet**
- `src/domain/trajectory/resolveObservations.ts` — `resolveEffectiveObservations()`, `consumableCleanedObservations()`
- `src/domain/trajectory/cleaningStaleness.ts` — stale applied-cleaning gate
- `src/domain/tracking/observationStatus.ts` — provisional `absent_in_hole` heuristic (MS-3 D7)
- `src/domain/constants.ts` — hole proximity, disappearance, cutoff defaults
- `src/domain/timing.ts` — container `timeUs` helpers; no FPS literals
- `src/store/sessionStore.ts` — staleness triggers on correction, geometry, window, calibration, cleaning params
- `src/components/CorrectionCleaningPanel.tsx`, `TrackQualityPanel.tsx` — MS-5 placeholder copy
- `AI_NOTES.md` — nose conservatism (~11–28% emission rate), `absent_in_hole` vs `lost` fix history

Key repository facts that shape MS-5:

1. **MS-3 `absent_in_hole` is provisional and target-gated.** Not an escape event — MS-5 builds separate, reviewable events on top.
2. **Observations do not store blob area or hole-darkening signals.** Bounded on-demand frame pass for escape candidates only.
3. **Nose is often absent by design.** Body fallback with explicit confidence; never synthetic nose.
4. **Target hole and `pxPerCm` may be unknown.** Target-dependent measures stay `unavailable`; **validation must not assign sample target holes to make tests pass.**
5. **All three sample clips end mid-entry** (constitution). Expect **incomplete-entry censoring** when progressive evidence exists — distinct from trials that simply end without observed entry evidence.

---

## Operational definitions (versioned, explicit)

Published Barnes maze protocols disagree on latency, errors, and search-strategy criteria. NeuroTrack AI **must not present one threshold set as universal truth**. Every measure carries:

- `definitionId` — stable identifier (e.g. `primary_latency.v1`)
- `definitionVersion` — semver or integer bump when formulas change
- `definitionLabel` — human-readable name shown in UI
- `definitionSummary` — one-sentence operational rule
- `parametersSnapshot` — thresholds used for this computation

Session-level `AnalysisParams.operationalDefinitions` selects among **supported variants** (not free-form text). Defaults are NeuroTrack recommendations, labeled as such.

| Definition | Default variant | Configurable alternatives |
|---|---|---|
| Primary latency | `first_target_investigation` (Q1 ✓) | `first_target_proximity`, `first_target_investigation_confirmed_only` |
| Total latency | `protocol_completion_time` (Q8 ✓) | See D5 — completion event, not entry onset |
| Primary / total errors | `confirmed_investigations` (Q9 ✓) | Provisional counts reported separately |
| Target quadrant | `target_centered_90` (Q3 ✓) | `fixed_orientation_90` (compass-aligned) |
| Search strategy | `heuristic_v1` (Q10 ✓) | Versioned; thresholds editable; `unclassified` allowed |

---

## Requirements

### A. Hole investigations

| # | Requirement |
|---|---|
| RA1 | Detect discrete **investigation** events per hole, distinct from escape completion. |
| RA2 | Evidence: proximity (nose preferred, body fallback), dwell (`timeUs`), optional approach motion (real Δt). |
| RA3 | Each auto event: evidence object + confidence (`high` / `medium` / `low`); not a fabricated probability. |
| RA4 | Thresholds visible, editable, versioned in `AnalysisParams.events`; changes recompute auto events (manual preserved per D9). |
| RA5 | Scientist can confirm, reject, add, edit investigations; manual events persist with provenance. |
| RA6 | Rejected events remain auditable (`status: 'rejected'`). |
| RA7 | Identity: `startFrameIndex` / `endFrameIndex`; timing: `startTimeUs` / `endTimeUs` from container. |
| RA8 | Pre-trial frames never contribute. |
| RA9 | Error model distinguishes **distinct-hole errors** vs **re-visit errors** (Q2 ✓). |

### B. Escape detection and censoring

| # | Requirement |
|---|---|
| RB1 | Escape from **temporal progressive evidence**, not single disappearance or binary present/absent. |
| RB2 | Evidence: hole proximity, area decay / motion loss, optional hole darkening (bounded pixel pass). |
| RB3 | Distinguish **four** outcomes (Q8 ✓): `escape_completed`, `escape_incomplete_censored`, `trial_censored_no_entry`, and **no escape record** (tracking loss / insufficient evidence). |
| RB4 | Never infer **completion** from recording end. Total latency refers to **protocol completion time**, not entry onset. |
| RB5 | When completion unobserved, preserve **observed follow-up duration** as a explicit **lower bound** on total latency. |
| RB6 | Censor boundary (`recording_end` | `protocol_cutoff`) is separate from entry onset and completion time. |
| RB7 | MS-3 `absent_in_hole` is supporting evidence only. |
| RB8 | Escape records show evidence; pixel pass may be incomplete — must surface `evidenceComplete: false` (Q4 ✓). |
| RB9 | Scientist can confirm, reject, or manually mark escape states with provenance. |

### C. Behavioral measures

| # | Requirement |
|---|---|
| RC1 | Compute from user-selected **measurement basis** (D2): Raw / Corrected / Cleaned. |
| RC2 | Structured values: `{ value, unit, censored, unavailable, lowerBound?, definitionId, definitionVersion, assumptions[], flags[] }`. |
| RC3 | **Primary latency** — configurable operational definition (default: first target investigation). |
| RC4 | **Total latency** — time to **completion** when observed; censored with lower bound when not (D5). |
| RC5 | **Errors** — finalized counts use **confirmed** investigations only; provisional counts shown separately (Q9 ✓). |
| RC6 | Error breakdown: `distinctHoleErrors`, `revisitErrors` (Q2 ✓). |
| RC7 | **Path length** — D12 rules (spatial sum; duplicate PTS handled separately from speed). |
| RC8 | **Speed** — D12: valid intervals only; time-weighted mean; max over valid intervals. |
| RC9 | **Target quadrant** — convention selectable (D6). |
| RC10 | **Search strategy** — versioned heuristics; `unclassified` when insufficient evidence (Q10 ✓); override persisted. |
| RC11 | Noncentral start → **assumption flag**, not automatic `random` classification. |
| RC12 | Measures recompute on basis, trajectory, events, thresholds, target, geometry, window, scale — without re-tracking. |

### D. Scientific invariants

| # | Requirement |
|---|---|
| RD1 | `frameIndex` = identity; `timeUs` = authoritative timing. |
| RD2 | Never infer time from FPS or frame index. |
| RD3 | Never mutate raw `track.observations`. |
| RD4 | Never consume stale cleaning; Cleaned basis unavailable with explanation when stale. |
| RD5 | Unknown target / scale → unavailable, never invented (including validation). |
| RD6 | Trajectory provenance (`origin`) reflected in assumptions when basis ≠ raw. |
| RD7 | Missing nose: body fallback with low confidence; never synthetic nose. |

### E. Manual review and recomputation

| # | Requirement |
|---|---|
| RE1 | **Events & Measures** panel: basis selector, definitions disclosure, thresholds, provisional vs confirmed counts, measures. |
| RE2 | Event selection seeks `startFrameIndex`; times from `timeUs`. |
| RE3 | Persist via Dexie / `migration.ts`. |
| RE4 | Recomputation matrix (D10). |
| RE5 | **Explicit “Detect events”** action for first run (Q6 ✓); auto re-detect when inputs change. |
| RE6 | Re-run tracking clears events and measures. |
| RE7 | Keyboard-accessible; `data-testid`s for Playwright. |

### F. Scope boundary

| # | Requirement |
|---|---|
| RF1 | No CSV/XLSX export (MS-6). |
| RF2 | No publication figures / heat maps (MS-6). |
| RF3 | No cohort batch queue. |
| RF4 | No ML pose upgrade by default. |
| RF5 | No per-filename tuning. |

---

## Approved decisions (Q1–Q10)

| ID | Decision | Spec binding |
|---|---|---|
| **Q1** | Primary latency = first target **investigation**; **configurable** definition variants | D5, Operational definitions table |
| **Q2** | Re-visits = separate errors; **distinct-hole vs re-visit** in data model | D7, `ErrorCounts` |
| **Q3** | Target-centered 90° default; **fixed-orientation** option | D6 |
| **Q4** | Bounded pixel evidence; **no silent truncation** | D4, D4b |
| **Q5** | **Raw / Corrected / Cleaned** basis selector; default **corrected-only** | D2 |
| **Q6** | Explicit **Detect events** initially; auto re-detect on input change | D10, Plan §11 |
| **Q7** | Auto events **proposed** until reviewed | D9 |
| **Q8** | Three censor/escape states + completion vs onset vs boundary + lower bound | D4, D5 |
| **Q9** | Provisional vs **confirmed** counts; finalized measures use confirmed only | D7, D9 |
| **Q10** | No mandatory center-start for spatial; **unclassified** allowed; versioned heuristics | D8 |

---

## Decisions

### D1 — Derived layers on `TrialRecord`

```typescript
TrialRecord.events: EventAnalysis | null
TrialRecord.measures: MeasuresSnapshot | null
TrialRecord.measurementBasis: MeasurementBasis  // persisted per trial

AnalysisParams.events: EventDetectionParams
AnalysisParams.quadrantConvention: QuadrantConvention
AnalysisParams.operationalDefinitions: OperationalDefinitionSelections
AnalysisParams.measurementBasisDefault: MeasurementBasis  // default 'corrected'
```

`EventAnalysis`: events, params snapshot, `computedAt`, optional `stale` / `staleReason`.

### D2 — Measurement basis (Q5 ✓)

```typescript
type MeasurementBasis = 'raw' | 'corrected' | 'cleaned';
```

| Basis | Source | When unavailable |
|---|---|---|
| **raw** | `track.observations` | No track |
| **corrected** | manual corrections applied to raw (**default**) | No track |
| **cleaned** | `consumableCleanedObservations()` only | Stale/missing applied cleaning → unavailable with banner; offer corrected fallback in UI |

**Implementation:** `resolveMeasurementObservations(track, basis)` pure function. UI selector in Events & Measures panel; persisted on `TrialRecord.measurementBasis`. Measures snapshot records `basisUsed` + assumption flags (`interpolated_fraction`, etc.).

**Tradeoff:** Three bases increase UI surface. Benefit: scientist sees exactly what trajectory produced numbers — not deferred to MS-6.

**Remaining approval:** None — Q5 decided.

### D3 — Investigation detection

Same core algorithm as prior plan; additions:

- **`visitIndex`** on investigation events — 1-based count of visits to that `holeId` (enables re-visit distinction).
- **`isRevisit: boolean`** — true when `visitIndex > 1`.

**Proximity defaults** (fractions of `platformRadiusPx`, versioned in `EventDetectionParams v1`):

| Parameter | Default |
|---|---|
| `investigationNoseProximityFraction` | 0.10 |
| `investigationBodyProximityFraction` | 0.14 |
| `investigationMinDwellUs` | 400_000 |
| `investigationMergeGapUs` | 300_000 |

**Confidence:** `high` / `medium` / `low` as before. Body-only rim visits → typically `low`.

### D4 — Escape states and timing (Q8 ✓)

Escape is **not** a single `escape_censored` blob. Separate concepts:

#### D4a — Escape event types

| Type | Meaning |
|---|---|
| `escape_completed` | Protocol completion observed with sufficient evidence |
| `escape_incomplete_censored` | Progressive entry evidence at a **identified hole**, but completion not observed before censor boundary |
| `trial_censored_no_entry` | Trial ended (recording or protocol cutoff) **without** sufficient entry evidence at any hole |
| *(no record)* | Mid-platform tracking loss, rim exploration without entry pattern — not an escape claim |

#### D4b — Timing fields (all from container `timeUs`)

| Field | Definition |
|---|---|
| `entryOnsetTimeUs` | First frame where entry evidence crosses onset threshold (proximity + decay begin) — **not** total latency |
| `completionTimeUs` | Frame/time where completion criteria met — **null** unless `escape_completed` |
| `censorBoundaryTimeUs` | `min(recording_end, protocol_cutoff, trial_window_end)` in container time |
| `observedFollowUpLowerBoundUs` | For **any** right-censored trial without completion: `censorBoundaryTimeUs − trialStartTimeUs`. When entry onset also detected, both fields are populated — lower bound is still the observed follow-up duration, not entry time. |

**Total latency (D5):** Value = `completionTimeUs − trialStartTimeUs` only when `escape_completed`. Otherwise `value: null`, `censored: true`, `lowerBound: observedFollowUpLowerBoundUs` (always set for censored trials, including `trial_censored_no_entry`). Entry onset is informational only for total latency.

**Never:** Set total latency to censor boundary time without `censored: true` and explicit state.

#### D4c — Phase A (trajectory) + Phase B (pixel)

Phase A unchanged in spirit: proximity streak, motion decay, position anchor.

Phase B (Q4 ✓): On-demand fetch when Phase A passes time-based gate (≥ 250 ms proximity span, not frame count).

**Pixel budget policy (no silent truncation):**

```typescript
interface PixelEvidenceRequest {
  startFrameIndex: number;
  endFrameIndex: number;
  requestedFrameCount: number;
}

interface PixelEvidenceResult {
  framesAnalyzed: number;
  framesRequested: number;
  complete: boolean;  // false if budget stopped fetch early
  unavailableReason?: 'budget_exceeded' | 'frame_worker_error' | 'missing_video_cache';
  areaDecayScore: number | null;
  holeDarkeningScore: number | null;
}
```

- Default soft budget: **300 frames per trial** (raised from 150 — tunable param, not hard silent cap).
- If window exceeds budget: analyze **trailing** frames first (most recent evidence); set `complete: false`.
- Classification when incomplete: **downgrade** escape confidence; never force `escape_completed` or **`trial_censored_no_entry`** from insufficient pixel data alone. Ambiguous Phase A + incomplete pixel → no escape record or `escape_incomplete_censored` with `pixel_evidence_incomplete` flag only when Phase A supports entry evidence.
- UI shows “Pixel evidence incomplete — N/M frames analyzed.”

**Implementation:** `eventFrameEvidenceService.ts` returns `PixelEvidenceResult`; escape scorer consumes with explicit incomplete handling.

**Tradeoff:** Incomplete pixel evidence may leave end-of-clip trials as `escape_incomplete_censored` with lower confidence rather than forced classification. Scientist can confirm manually.

**Remaining approval:** Default pixel budget (300 vs adaptive by window duration) — recommend 300 trailing-first; flag if you prefer unlimited with progress UI only.

### D5 — Latency operational definitions (Q1, Q8 ✓)

**Trial start anchor:** `trialWindow.startTimeUs` (confirmed or accepted-proposed).

**Primary latency** — selected variant:

| Variant ID | Rule |
|---|---|
| `first_target_investigation` (**default**) | First **confirmed** target-hole investigation `startTimeUs − trialStart` |
| `first_target_proximity` | First in-zone frame at target hole (dwell not required) |
| `first_target_investigation_confirmed_only` | Same as default (alias for clarity in UI) |

Provisional target investigations do **not** count for primary latency until confirmed (Q9 alignment).

If no qualifying event before censor: `censored: true`, `value: null`, flag per escape state.

**Total latency** — `protocol_completion_time` (fixed definition ID):

- **Completion event** = criteria for `escape_completed.completionTimeUs`, not entry onset.
- Aligns with task brief “time until it actually enters the escape box” — operationalized as **completed descent**, not first rim contact.

**Remaining approval:** None for primary default. Completion criteria thresholds remain tunable under `EventDetectionParams`.

### D6 — Quadrant conventions (Q3 ✓)

| Convention | Rule |
|---|---|
| `target_centered_90` (**default**) | 90° sector centered on confirmed target hole |
| `fixed_orientation_90` | Four quadrants from fixed compass angle `quadrantNorthDeg` (user-set, e.g. top of video = 0°) |

Measure: time-weighted fraction of in-trial duration with body in target quadrant. Unavailable if target unconfirmed (target-centered mode) or `quadrantNorthDeg` unset (fixed mode).

### D7 — Error counting (Q2, Q9 ✓)

```typescript
interface ErrorCounts {
  /** Confirmed non-target investigations before boundary — finalized measure */
  confirmed: {
    total: number;
    distinctHoleCount: number;
    revisitCount: number;
    byHoleId: Record<number, { visits: number; distinct: boolean }>;
  };
  /** Provisional (status=proposed OR confidence=low) — displayed, not in finalized totals */
  provisional: {
    total: number;
    distinctHoleCount: number;
    revisitCount: number;
  };
}
```

**Finalized primary/total errors** use investigations with **`status === 'confirmed'`** OR **`origin === 'manual'`** (manual defaults confirmed):

- `status === 'proposed'` → provisional bucket only (regardless of confidence)
- `status === 'rejected'` → excluded entirely
- **`status === 'confirmed'` → confirmed bucket even when `confidence === 'low'`** (status takes precedence)
- **`confidence === 'low'` with `status === 'proposed'`** → provisional only until scientist confirms

**Re-visit vs distinct (Q2):** First visit to hole H = distinct error; subsequent visits to same H before boundary = `revisitCount` increments separately. Both contribute to `confirmed.total` when confirmed.

**Boundaries:**

- Primary errors: before first confirmed target investigation (or primary latency event).
- Total errors: before `censorBoundaryTimeUs`.

Unavailable when target unconfirmed.

### D8 — Search strategy (Q10 ✓)

**Not universal standards** — labeled `Search strategy (heuristic v1)` in UI with link to parameter disclosure.

```typescript
type SearchStrategyClass = 'spatial' | 'serial' | 'random' | 'unclassified';
```

**Heuristic v1 defaults** (all editable, version-bumped when changed):

| Class | Criteria |
|---|---|
| **spatial** | `DI = chord_length / path_length ≥ diThreshold` (default 0.55) **and** ≤ `maxDistinctHolesBeforeTarget` (default 2) non-target confirmed investigations before first target |
| **serial** | ≥ `minSerialHoles` (default 4) distinct holes visited in monotonic angular order with ≤ `maxSerialViolations` (default 2) |
| **random** | High center-crossing count (≥ `centerCrossingThreshold`, default 2) **or** high distinct-hole count without serial pattern |
| **unclassified** | Insufficient evidence for any class above confidence floor |

**Removed:** Mandatory center-start for spatial (Q10 ✓).

**Noncentral start:** If `startDistanceFraction > noncentralStartFlagFraction` (default 0.35), add assumption `noncentral_start` — does **not** auto-assign `random`.

**Reasoning payload:** `{ directnessIndex, distinctHolesVisited, angularMonotonicity, centerCrossings, startDistanceFraction, classifierVersion }`.

Manual override persisted with reason.

**Validation:** Synthetic fixtures + manual review examples documented in spec; thresholds not claimed to match any single paper.

**Tradeoff:** More `unclassified` trials vs false confidence. Prefer honest unclassified.

**Remaining approval:** None — Q10 decided.

### D9 — Event provenance (Q7 ✓)

```typescript
interface Event {
  id: string;
  type: 'investigation' | 'escape_completed' | 'escape_incomplete_censored' | 'trial_censored_no_entry';
  holeId: number | null;
  startFrameIndex: number;
  endFrameIndex: number;
  startTimeUs: number;
  endTimeUs: number;
  entryOnsetTimeUs?: number | null;
  completionTimeUs?: number | null;
  censorBoundaryTimeUs?: number | null;
  origin: 'auto' | 'manual';
  status: 'proposed' | 'confirmed' | 'rejected';
  confidence: 'high' | 'medium' | 'low' | null;
  visitIndex?: number;
  isRevisit?: boolean;
  evidence: Record<string, number | string | boolean | null>;
  notes: string | null;
}
```

Auto → `proposed`. Manual add → `confirmed`. Batch confirm allowed.

Threshold recompute: preserve manual + confirmed/rejected matches; else mark `EventAnalysis.stale`.

### D10 — Detect events workflow (Q6 ✓)

| When | Behavior |
|---|---|
| First time after tracking | User clicks **Detect events** (disabled until track `done` + geometry/window satisfied) |
| Trajectory / basis / geometry / window / target / event params change | Auto **re-detect** auto events; preserve manual per D9; recompute measures |
| Manual event edit | Recompute measures only |
| Re-run tracking | Clear events & measures |

No silent auto-run on tracking complete.

### D11 — Recomputation matrix

| Trigger | Events | Measures |
|---|---|---|
| Detect events (explicit) | Full detect | Compute |
| Manual correction | Re-detect auto | Recompute |
| Measurement basis change | **Re-detect auto events** + recompute measures (preserve manual per D9); record `basisUsed` |
| Cleaning apply | Re-detect if events exist | Recompute |
| Stale cleaning + basis=cleaned | — | Measures unavailable until re-apply or basis change |
| Event threshold / definition change | Re-detect auto | Recompute |
| Event confirm/reject | — | Recompute (provisional vs confirmed) |
| Target / geometry / window | Re-detect | Recompute |
| Re-track | Clear | Clear |

### D12 — Path length and speed (duplicate PTS correction)

**Path length:**

- Sum Euclidean **`bodyXY`** displacements between consecutive **in-trial** observations with valid body points, in `frameIndex` order.
- **Duplicate PTS (`ΔtimeUs === 0`):** **Include spatial displacement** in path length (valid movement may occur between composition-time duplicates).
- **Unsupported gaps** (`lost`, null body, `absent_pre_trial`, `absent_in_hole`): break path into segments; sum segments; report `pathLengthExcludedGapUs` in assumptions.
- Do **not** silently bridge gaps unless basis=cleaned and point is `interpolated` — flag `includes_interpolated_segments`.

**Speed:**

- Instantaneous speed defined only when **`ΔtimeUs > 0`**: `speed = distance / (ΔtimeUs / 1e6)`.
- **`ΔtimeUs === 0`:** speed **undefined** at that pair — exclude from speed aggregates (do not divide by zero).
- **Mean speed:** time-weighted over valid intervals: `Σ (speed_i × Δt_i) / Σ Δt_i` (not frame-count average).
- **Max speed:** max over valid instantaneous speeds.
- Report `validSpeedIntervalCount` and `excludedZeroDtPairs` in assumptions.

**Dwell (investigations):** One in-zone sample per duplicate-PTS group (dedupe by `frameIndex`).

### D13 — Target hole and scale dependencies

| Dependency | If missing |
|---|---|
| `targetHoleConfirmedAt` | Primary latency (target variants), errors, target quadrant (target-centered) → **unavailable** |
| `pxPerCm` | Path length / speed in cm → **px with flag**; cm fields unavailable |
| Target for validation | Scripts use **user-confirmed** state from Playwright flow — **never hard-code test50/test51/test53 target IDs** |

---

## Plan

1. **Data model** — Types above + `MeasurementBasis`, `ErrorCounts`, `OperationalDefinitionSelections`, escape timing fields.
2. **Migration** — Backfill nulls; default `measurementBasis: 'corrected'`, `measurementBasisDefault: 'corrected'`.
3. **`resolveMeasurementObservations(track, basis)`** — raw / corrected / consumable cleaned with stale gate.
4. **Geometry helpers** — `holeProximity.ts`, quadrant math for both conventions.
5. **`investigations.ts`** — dwell, merge, visitIndex, confidence.
6. **`escape.ts`** — four-state classifier, onset/completion/boundary/lower-bound fields.
7. **`escapeFrameEvidence.ts`** + service — trailing-first budget, `complete` flag.
8. **`detectEvents.ts`** — orchestrator (pure).
9. **`computeMeasures.ts`** — latencies, ErrorCounts provisional/confirmed, path (D12), speed (D12), quadrant, strategy v1.
10. **`eventStaleness.ts`** + store wiring.
11. **Store** — `detectEvents(trialId)` explicit action; auto re-detect on D11 triggers; **no** auto-run on track done.
12. **`EventsMeasuresPanel.tsx`** — basis selector, Detect events, definitions/version disclosure, provisional vs confirmed error tables, censor state badges, lower bound display.
13. **Overlay / timeline** — investigation spans; escape onset vs censor boundary markers (distinct styles).
14. **Unit tests** — expanded per Validation Tier 1.
15. **`validate-events-offline.mjs`** — synthetic states without browser.
16. **`validate-ms5.mjs`** — Playwright; target confirmation in-flow, not baked-in sample IDs.
17. Replace MS-5 placeholder in correction panel with Events & Measures entry.

---

## Validation

### Tier 1 — Unit tests (must pass)

| # | Case |
|---|---|
| U1 | Dwell uses Δ`timeUs` (test51-like spacing). |
| U2 | Body-only → low confidence; no synthetic nose. |
| U3 | visitIndex / isRevisit on repeat hole visits. |
| U4 | ErrorCounts: provisional low-confidence excluded from confirmed.total. |
| U5 | Confirmed reject excluded; manual confirmed included. |
| U6 | Mid-platform lost → no escape record. |
| U7 | **`escape_completed`** synthetic → total latency = completion − start. |
| U8 | **`escape_incomplete_censored`** → total latency censored + lower bound = censor − start. |
| U9 | **`trial_censored_no_entry`** → censored + lower bound = censor − start; entry fields null. |
| U10 | Never set total latency to recording duration without censored flag. |
| U11 | Duplicate PTS: path includes displacement; speed excludes zero-Δt pair. |
| U12 | Time-weighted mean speed ≠ unweighted frame mean. |
| U13 | Path segments break at unsupported gaps; assumptions report excluded time. |
| U14 | Pixel budget exceeded → `complete: false`; no forced `escape_completed`. |
| U15 | Measurement basis: raw vs corrected vs cleaned changes path length when corrections exist. |
| U16 | Stale cleaning + basis=cleaned → measures unavailable. |
| U17 | Strategy: noncentral start → flag, not auto-random; may be unclassified. |
| U18 | Target unknown → errors/latency unavailable. |
| U19 | distinctHoleCount vs revisitCount on multi-visit fixture. |
| U20 | Primary latency definition switch changes result. |

### Tier 2 — Synthetic fixtures

| Fixture | Purpose |
|---|---|
| `escape_completed.json` | Full completion → numeric total latency |
| `escape_incomplete_censored.json` | Entry onset + censor → lower bound only |
| `trial_censored_no_entry.json` | End without entry evidence |
| `false_rim_escape.json` | Rim exploration → no escape record |
| `duplicate_pts_path.json` | Non-zero path, undefined speed pair |
| `provisional_errors.json` | Low-confidence visits in provisional only |
| `strategy_unclassified.json` | Insufficient pattern → unclassified |
| `strategy_noncentral_spatial.json` | Direct path, rim start → spatial + flag |
| `unknown_target.json` | Target-dependent measures unavailable |

### Tier 3 — Playwright (`validate:ms5`)

| # | Criterion |
|---|---|
| V1 | Detect events (explicit click) after track + in-flow target confirm → investigations visible. |
| V2 | Threshold change → event count changes. |
| V3 | Sample clips: **not** `escape_completed`; show `escape_incomplete_censored` or `trial_censored_no_entry` appropriately — never bare duration as total latency. |
| V4 | Lower bound shown when incomplete entry censored. |
| V5 | No false escape on mid-platform lost. |
| V6 | Confirm low-confidence investigation → moves from provisional to confirmed error count. |
| V7 | Measurement basis toggle changes path length (with correction fixture). |
| V8 | Strategy unclassified or flagged noncentral — not forced random. |
| V9 | Pixel incomplete flag when budget exceeded (mock or small budget param). |
| V10 | MS-1–MS-4 regressions green. |

**Validation policy:** Do not assign target holes in scripts except through UI confirmation step in test flow. Clips may be analyzed with target unknown to verify unavailable measures.

### Tier 4 — Manual review

- End-of-clip states verbally distinct in UI (“incomplete entry at censor” vs “trial ended without entry evidence”).
- Operational definition labels visible on every measure card.
- Provisional vs confirmed error tables match scientist expectation on test53.
- test51: no escape from cylinder period.

---

## Remaining tradeoffs (minor — optional approval)

| ID | Topic | Recommendation |
|---|---|---|
| **T1** | Default pixel budget | 300 frames trailing-first; param exposed |
| **T2** | Auto re-detect on correction | Yes (D11) — may invalidate unreviewed proposed events; show stale banner |
| **T3** | `first_target_proximity` variant | Ship but not default — noisier for fly-bys |

---

## Repository-specific recommendations

1. Reuse hole proximity constants as **starting points** only — label as heuristic v1.
2. MS-3 `absent_in_hole` → hint for Phase B window only when target confirmed.
3. Pure-function detectors for offline validation.
4. UI copy: three censor states must not collapse to “never escaped.”
5. No blob area on all observations — on-demand only with completeness flag.

---

## Known limitations (expected after MS-5)

- Heuristic strategy ≠ any single published method — overrides and unclassified required.
- Body-only investigations common at rim — provisional until confirmed.
- Sample clips likely never reach `escape_completed`.
- Incomplete pixel evidence reduces auto confidence — manual confirmation path provided.
- Path length across gaps discontinuous unless cleaned interpolated segments included (flagged).

---

## Completion criteria (future sign-off)

1. Tier 1–3 validation pass including new escape/censor/basis/strategy cases.
2. Manual review of three-state censor model and provisional/confirmed errors.
3. MS-1–MS-4 regressions green.
4. `AI_NOTES.md` records Q1–Q10 binding decisions and any T1–T3 choices.

**Do not mark complete or merge until explicit post-implementation review.**
