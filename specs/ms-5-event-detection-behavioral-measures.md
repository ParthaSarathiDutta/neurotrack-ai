# MS-5 — Event Detection & Behavioral Measures

Branch: `ms-5-event-detection-behavioral-measures`
Base: `main` @ `e3ef219` (MS-4 complete)
Constitution reference: `specs/constitution.md` → MS-5
Status: **Plan only — not implemented**

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

1. **MS-3 `absent_in_hole` is provisional and target-gated.** `classifyMissingObservation()` emits `absent_in_hole` only when `geometry.targetHoleConfirmedAt` is set, the nearest hole is the confirmed target, and a multi-frame temporal gate passes (hole interaction streak, area collapse, shrink/slow evidence). Non-target disappearances remain `lost`. This is **not** an escape event — MS-5 must build separate, reviewable events on top.
2. **Observations do not store blob area or hole-darkening signals.** Escape evidence that depends on pixel statistics requires either (a) a lightweight on-demand frame pass over candidate windows via the existing `frame-worker`, or (b) extending the tracking worker — (a) is recommended to avoid re-tracking and to keep MS-3 raw observations immutable.
3. **Nose is often absent by design.** MS-3 emits `noseXY` only when heading and shape agree; many rim/occlusion frames are body-only. Event detection must degrade gracefully — never infer a nose from body geometry.
4. **Trajectory input for measures:** `resolveEffectiveObservations()` merges raw → manual → consumable cleaning. If applied cleaning is stale, measures fall back to **corrected-only** trajectory with a visible warning — never silently use stale cleaning (`consumableCleanedObservations()` returns `null`).
5. **Target hole and `pxPerCm` may be unknown.** `Geometry.targetHoleConfirmedAt` and `Geometry.pxPerCm` are nullable; target-dependent measures must be `unavailable`, not fabricated.
6. **All three sample clips end mid-entry** (constitution finding #3–#4). MS-5 validation must expect **right-censored total latency** on all three, never a silent “never escaped” or a numeric total latency equal to clip duration without a censor flag.

---

## Requirements

### A. Hole investigations

| # | Requirement |
|---|---|
| RA1 | Detect discrete **investigation** events per hole from trajectory + geometry, distinct from escape entry. |
| RA2 | Investigation evidence combines **proximity** (nose preferred, body fallback), **dwell time** (container `timeUs` span), and optional **approach motion** (radial velocity toward hole center using real Δt). |
| RA3 | Every auto-detected investigation carries **evidence** (distances, dwell, approach speed, nose vs body basis, frame range) and a **confidence** tier (`high` / `medium` / `low`), not a fabricated probability. |
| RA4 | All thresholds are **visible, editable**, stored in `AnalysisParams.events`, and changing a threshold **immediately recomputes** auto events (manual events preserved per D9). |
| RA5 | Scientist can **confirm**, **reject**, **add**, and **edit** investigations; manual events carry `origin: 'manual'` and survive reload. |
| RA6 | Rejected auto events stay auditable (not deleted silently) with `status: 'rejected'`. |
| RA7 | Investigations are keyed by `startFrameIndex` / `endFrameIndex` for identity; `startTimeUs` / `endTimeUs` copied from `timestampIndex` for all timing. |
| RA8 | Pre-trial frames (`absent_pre_trial`) never contribute to investigations. |

### B. Escape detection and censoring

| # | Requirement |
|---|---|
| RB1 | Escape is detected from **temporal progressive evidence**, not a single disappearance frame or binary blob-present rule. |
| RB2 | Escape evidence combines: (1) sustained proximity to a **specific hole**, (2) **area decay** and/or motion loss in a trailing window, (3) optional **hole-region darkening** from a bounded frame pass — matching constitution finding #3. |
| RB3 | Distinguish three outcomes: **`escape_entry`** (completed entry with sufficient evidence), **`escape_censored`** (entry in progress or unconfirmed at trial end / protocol cutoff), and **`tracking_loss`** (mid-platform or non-hole loss — never an escape). |
| RB4 | **Do not assume completed escape** on any sample clip. End-of-recording descent with progressive evidence → **`escape_censored`**, not `escape_entry`, unless evidence crosses the completion threshold (likely never on supplied clips). |
| RB5 | Censored total latency is reported with `censored: true` and explicit reason (`recording_end` | `protocol_cutoff`); never emit an uncensored number equal to clip duration without a flag. |
| RB6 | MS-3 `absent_in_hole` observations are **supporting evidence only**, never auto-promoted to escape events without MS-5's full evidence model. |
| RB7 | Escape events show evidence panel (hole id, evidence scores, frame/time range, censor reason if applicable). |
| RB8 | Scientist can confirm, reject, or manually mark escape / censoring with provenance. |

### C. Behavioral measures

| # | Requirement |
|---|---|
| RC1 | Compute from the **measurement trajectory** (see D2): primary latency, total latency, primary errors, total errors, path length, mean speed, max speed, time in target quadrant, search strategy. |
| RC2 | Each measure is a structured value: `{ value, unit, censored, unavailable, unavailableReason?, definitionId, assumptions[], flags[] }` — never a bare number in persistence. |
| RC3 | **Primary latency** — time from trial start to first target-hole investigation (see D5; subject to approval). |
| RC4 | **Total latency** — time from trial start to `escape_entry.startTimeUs`; if censored, `value = null`, `censored = true`, `flags` include censor reason. |
| RC5 | **Primary errors** — count of non-target hole investigations whose **start** occurs strictly before first target investigation; unavailable if target unknown. |
| RC6 | **Total errors** — count of non-target investigations before escape/censoring end boundary; unavailable if target unknown. |
| RC7 | **Path length** — sum of Euclidean body displacements between consecutive in-trial frames with valid `bodyXY`, using only adjacent `timeUs` pairs; units cm if `pxPerCm` known else px with flag. |
| RC8 | **Speed** — instantaneous speed from body displacements / Δ`timeUs`; report mean and max over in-trial tracked frames; same unit rules as path length. |
| RC9 | **Target quadrant time** — fraction or seconds in the 90° sector centered on the confirmed target hole (see D6); unavailable if target unknown. |
| RC10 | **Search strategy** — classify as `spatial`, `serial`, or `random` with **reasoning metrics shown**; scientist can **override** with persisted provenance. |
| RC11 | Assumption violations (e.g. start not near platform center) add `assumptions[]` flags; do not silently score as spatial. |
| RC12 | Measures recompute when trajectory, events, thresholds, target, geometry, window, or scale change — without re-tracking. |

### D. Scientific invariants

| # | Requirement |
|---|---|
| RD1 | **`frameIndex`** is identity for events, corrections, and frame navigation; **`timeUs`** is authoritative for all latencies, dwells, speeds, and censor boundaries. |
| RD2 | Never infer timing from nominal FPS, `frameIndex` deltas, or `nb_frames` metadata. |
| RD3 | Never mutate `track.observations` (raw MS-3 output). Events and measures are derived layers on `TrialRecord`. |
| RD4 | Never consume **stale** applied cleaning; fall back to corrected-only with warning (D2). |
| RD5 | Never invent target hole identity or platform diameter — unavailable beats fabricated. |
| RD6 | Preserve uncertainty: distinguish `auto`, `manual`, `interpolated`, `smoothed` trajectory origins in measure assumptions when cleaning was used. |
| RD7 | Missing nose: investigations may use body with wider threshold and `low` confidence; never synthesize nose for event detection. |

### E. Manual review and recomputation

| # | Requirement |
|---|---|
| RE1 | New **Events & Measures** panel in review view: event list, threshold controls, measure summary, evidence/reasoning disclosure. |
| RE2 | Selecting an event seeks the player to `startFrameIndex` (identity), displays times from `timeUs`. |
| RE3 | Event edits persist via Dexie / `migration.ts`. |
| RE4 | Recomputation matrix (D10) is implemented consistently in store actions. |
| RE5 | Re-run tracking clears events and measures (same discipline as corrections/cleaning). |
| RE6 | Keyboard-accessible, labeled controls; `data-testid`s for Playwright. |

### F. Scope boundary (MS-5 does NOT include)

| # | Requirement |
|---|---|
| RF1 | **No CSV/XLSX export** — MS-6. Measures must be structured for export but not exported yet. |
| RF2 | **No trajectory heat maps, learning curves, or publication figures** — MS-6. |
| RF3 | **No cohort batch queue** — stretch. |
| RF4 | **No ML pose upgrade** — only if classical evidence proves insufficient, record in `AI_NOTES.md`; not default MS-5 scope. |
| RF5 | **No per-filename tuning** — thresholds are global defaults validated on all three clips, not branched on `test50`/`test51`/`test53`. |

---

## Decisions

### D1 — Events and measures are derived layers on `TrialRecord`

Extend the constitution contract:

```typescript
TrialRecord.events: EventAnalysis | null
TrialRecord.measures: MeasuresSnapshot | null
AnalysisParams.events: EventDetectionParams
AnalysisParams.quadrantConvention: QuadrantConvention
```

`EventAnalysis` holds auto + manual events, params snapshot, `computedAt`, and optional `stale` / `staleReason` (mirrors applied-cleaning pattern). Raw tracking untouched.

### D2 — Measurement trajectory selection (recommended)

Priority order for measure/event input:

1. If `consumableCleanedObservations(track)` is non-null → use cleaned + corrected trajectory; set measure flag `trajectory_basis: 'cleaned'`.
2. Else if corrected trajectory exists → use `resolveEffectiveObservations()` without stale cleaning; flag `trajectory_basis: 'corrected'`.
3. If track missing or no in-trial body points → measures `unavailable`.

Never use stale `appliedCleaning`. UI shows a banner when measures run on corrected-only because cleaning is stale.

**Tradeoff:** Some labs prefer raw-only measures; we defer raw-only mode to MS-6 export options unless you approve adding a toggle in MS-5.

### D3 — Investigation detection algorithm (recommended)

**Per-frame scoring (in-trial only):** For each hole `h`, compute:

- `d_nose = dist(noseXY, h)` if `noseXY != null`
- `d_body = dist(bodyXY, h)` if `bodyXY != null`
- `d = d_nose` if nose present, else `d_body` (never both blended into one fake point)

**Proximity thresholds** (defaults as fractions of `platformRadiusPx`):

| Parameter | Default | Role |
|---|---|---|
| `investigationNoseProximityFraction` | 0.10 | Nose within this → in-zone |
| `investigationBodyProximityFraction` | 0.14 | Body-only within this → in-zone (wider) |
| `investigationMinDwellUs` | 400_000 (0.4 s) | Minimum contiguous in-zone span |
| `investigationMergeGapUs` | 300_000 | Merge same-hole segments separated by ≤ this gap |
| `investigationMinApproachSpeedPxPerSec` | null (off by default) | Optional radial approach filter |

**Dwell** accumulates only while in-zone and `observed !== 'absent_pre_trial'`. Gaps in body/nose during dwell pause accumulation but do not reset if gap ≤ `investigationMergeGapUs`.

**Event creation:** When dwell ≥ `investigationMinDwellUs`, emit investigation with `startTimeUs`/`endTimeUs` from first/last in-zone frame's container times.

**Confidence:**

- `high` — nose-based dwell ≥ min, no `ambiguous_head_tail` in span
- `medium` — nose-based with flags, or body-only dwell ≥ min
- `low` — body-only with `lost`/`low_confidence` frames in span

**Non-target vs target:** Same detector; error/latency logic uses `geometry.targetHoleId` only when `targetHoleConfirmedAt` is set.

### D4 — Escape detection: progressive evidence score (recommended)

Escape is a **separate pipeline stage** from investigations, evaluated per hole candidate near trial end and on `absent_in_hole` streaks.

**Phase A — Trajectory-only (always runs, no pixels):**

For each hole `h`, scan trailing window `W` (default last 3 s of in-trial time or from first sustained proximity):

| Signal | Computation |
|---|---|
| Proximity streak | Consecutive frames with `min(d_nose, d_body) ≤ escapeProximityFraction × R` (default 0.12 × R) |
| Motion decay | Mean body speed in last N frames vs prior N frames (Δ from `timeUs`) drops below `escapeMotionDecayRatio` (default 0.35) |
| Position anchor | Last known body/nose near hole `h` |

**Phase B — Pixel evidence (on-demand, bounded):**

When Phase A score ≥ `escapePixelPassThreshold` (default: proximity streak ≥ 8 frames at 30 fps equivalent **time span**, not frame count — use ≥ 250 ms), fetch frames via `frame-worker` for `[startFrameIndex .. endFrameIndex]` only:

| Signal | Computation |
|---|---|
| Area decay | Blob area fraction vs recent peak (reuse tracking foreground pipeline on single frames) |
| Hole darkening | Mean gray in hole disk vs platform background in annulus |

**Scoring:** Weighted sum → `escapeEvidenceScore` 0–1. Weights exposed as advanced params; defaults conservative.

**Classification:**

| Outcome | Condition |
|---|---|
| `escape_entry` | Score ≥ `escapeConfirmThreshold` (default 0.75) **and** area decay + proximity sustained **and** trial not ended before completion |
| `escape_censored` | Score ≥ `escapeCensorThreshold` (default 0.45) but below confirm **or** trial/recording ends during progressive entry **or** protocol cutoff reached first |
| No escape event | Score below censor threshold → no escape event; mid-platform `lost` streaks never score |

**Sample clips:** Expect **`escape_censored`** at recording end for all three with hole id = confirmed target (when target set). If target unknown, escape may cite hole by proximity only with `assumptions: ['target_unknown_hole_by_proximity']`.

**Tradeoff:** Phase B adds complexity but is necessary to distinguish constitution's progressive descent from mid-platform tracking loss. Phase A alone fails validation criterion “false escape prevention” on rim exploration. **Recommend Phase B for MS-5** with strict window bounding (≤ 150 frames fetched per trial).

### D5 — Latency definitions (recommended; **requires approval**)

| Measure | Definition | Trial start anchor |
|---|---|---|
| Primary latency | Time from **trial start** to **start** of first **target-hole investigation** | `trialWindow.startTimeUs` (confirmed or accepted-proposed) |
| Total latency | Time from trial start to **start** of `escape_entry` | Same start anchor |

**Alternatives flagged for approval:**

- **A (recommended):** Primary = first target **investigation** (matches “reaches target hole” in task brief when investigation = operationalized hole visit).
- **B:** Primary = first frame nose/body within target proximity regardless of dwell (more sensitive, noisier).
- **C:** Primary = first target investigation with `confidence !== 'low'`.

If **no target investigation** occurs before censoring: primary latency → `censored: true`, `value: null`, flag `no_target_visit`.

### D6 — Target quadrant convention (recommended; **requires approval**)

**Target-centered quadrant:** Partition platform into 4 sectors of 90° each, anchored so the **confirmed target hole** lies at the **center** of quadrant 1 (the “target quadrant”). Quadrant boundaries are rays from `platformCenter` at angles `[θ_target − 45°, θ_target + 45°)` etc., where `θ_target = atan2(h_target − center)`.

**Measure:** Sum of Δ`timeUs` for in-trial frames whose body angle from center falls in target quadrant / total in-trial duration → `targetQuadrantFraction` and `targetQuadrantTimeSec`.

Report convention string in UI and measures: `"Target-centered 90° sector (target at sector center)"`.

Unavailable when target unconfirmed.

### D7 — Error counting (recommended; **requires approval**)

- Count **investigation events**, not raw proximity frames.
- A non-target investigation counts as one error if its `startTimeUs` is strictly before the first target investigation's `startTimeUs` (primary errors) or before escape/censor end boundary (total errors).
- **Re-visits** to the same wrong hole count as separate errors (matches clicker-style counting); flag in UI.
- Investigations with `status: 'rejected'` do not count.
- Manual investigations count when `status: 'confirmed'` or `origin: 'manual'`.

### D8 — Search strategy classifier (recommended)

Compute from measurement trajectory between trial start and first target investigation (or censor end if no target visit):

| Class | Criteria (all use body path, container times) |
|---|---|
| **spatial** | Directness index `DI = chord_length / path_length ≥ 0.55` **and** start within `centerStartFraction × R` (default 0.35) of platform center **and** first target investigation occurs without visiting ≥ 3 distinct non-target holes |
| **serial** | Visit ≥ 4 distinct holes in monotonic angular order (clockwise or CCW) with ≤ 2 violations |
| **random** | Neither spatial nor serial; or start not near center (assumption flag) |

Emit `strategyReason: { directnessIndex, distinctHolesVisited, angularMonotonicity, startDistanceFraction }`.

Manual override: `measures.searchStrategy.override = 'spatial'|'serial'|'random'` with `overrideReason` text; persisted.

**Tradeoff:** Strategy from automated rules will disagree with human raters; overrides and visible reasoning are mandatory, not optional polish.

### D9 — Manual event provenance

```typescript
interface Event {
  id: string;
  type: 'investigation' | 'escape_entry' | 'escape_censored';
  holeId: number | null;
  startFrameIndex: number;
  endFrameIndex: number;
  startTimeUs: number;
  endTimeUs: number;
  origin: 'auto' | 'manual';
  status: 'proposed' | 'confirmed' | 'rejected';
  confidence: 'high' | 'medium' | 'low' | null;
  evidence: Record<string, number | string | boolean | null>;
  notes: string | null;
}
```

- Auto events default `status: 'proposed'` until scientist confirms (batch “Confirm all” allowed).
- Manual add → `origin: 'manual'`, `status: 'confirmed'`.
- Threshold recompute: regenerate auto events; **preserve** manual and confirmed/rejected state for events whose `(type, holeId, startFrameIndex)` matches within merge tolerance; otherwise mark `EventAnalysis.stale` and require review (safer than silent overwrite).

### D10 — Recomputation matrix

| Trigger | Events | Measures | Cleaning staleness |
|---|---|---|---|
| Manual trajectory correction | Recompute auto events; mark analysis stale if manual escape edits exist | Recompute | Already stale (MS-4) |
| Apply / re-apply cleaning | Recompute | Recompute | Cleared on apply |
| Stale cleaning (no re-apply) | Recompute on corrected-only | Recompute with flag | — |
| Event threshold change | Recompute auto | Recompute | — |
| Manual event confirm/reject/add | Preserve manual | Recompute | — |
| Target hole change | Recompute | Recompute; errors/latency may become unavailable | Stale cleaning (MS-4) |
| Geometry / window / pxPerCm change | Recompute | Recompute | Stale cleaning |
| Re-run tracking | Clear events & measures | Clear | Clear corrections & cleaning (existing) |

### D11 — Missing nose handling (explicit)

| Situation | Investigation behavior |
|---|---|
| `noseXY` present | Use nose proximity; higher confidence |
| `noseXY` null, `bodyXY` present | Body proximity with wider threshold; `confidence: low` or `medium` |
| Both null | No in-zone score; may split dwell segments |
| Manual nose correction | Treat as present for that `frameIndex` only |

Measure assumptions include `nose_coverage_fraction` so reviewers see when body-only detection dominated.

### D12 — Duplicate container PTS

When adjacent observations share `timeUs`:

- Dwell accumulation uses **one** in-zone sample per duplicate group (dedupe by `frameIndex` order).
- Speed / path length: skip zero Δt pairs; never divide by zero.
- Event boundaries remain keyed by `frameIndex`; displayed times use that frame's `timeUs` (may duplicate — show frame index in evidence).

---

## Plan

1. **Data model** — Add `Event`, `EventAnalysis`, `EventDetectionParams`, `MeasureValue`, `MeasuresSnapshot`, `QuadrantConvention` to `types.ts`. Extend `TrialRecord`, `AnalysisParams`. Defaults in `trialFactory.ts`.
2. **Migration** — Backfill `events: null`, `measures: null`, default event params in `migration.ts`; bump `TOOL_VERSION`.
3. **Trajectory gate** — Add `measurementObservations(track)` helper wrapping D2 logic + assumption flags.
4. **Geometry helpers** — `holeProximity.ts`: distance to hole, nearest hole, rim band, target angle/quadrant (pure functions).
5. **Investigation detector** — `src/domain/events/investigations.ts` — segment, dwell, merge, confidence (unit-tested).
6. **Escape detector** — `src/domain/events/escape.ts` — Phase A scoring; Phase B interface + `escapeFrameEvidence.ts` using frame-worker adapter.
7. **Frame evidence service** — `src/services/eventFrameEvidenceService.ts` — bounded fetch + blob area + hole darkness for candidate windows only.
8. **Event orchestrator** — `src/domain/events/detectEvents.ts` — combines investigations + escape; returns `EventAnalysis`.
9. **Measures** — `src/domain/measures/computeMeasures.ts` — latencies, errors, path, speed, quadrant, strategy from events + trajectory (unit-tested).
10. **Staleness** — `src/domain/events/eventStaleness.ts` — mirror cleaning staleness; wire triggers in `sessionStore.ts`.
11. **Store actions** — `runEventDetection`, `updateEventParams`, `confirmEvent`, `rejectEvent`, `addManualEvent`, `overrideSearchStrategy`, auto-run after tracking completes (optional toggle: default on).
12. **UI** — `EventsMeasuresPanel.tsx` — threshold sliders/inputs, event list, measure cards with censored/unavailable badges, evidence disclosure, strategy override.
13. **Overlay** — Highlight investigation spans and escape window on timeline; hole markers for event holes.
14. **Unit tests** — `tests/investigations.test.ts`, `tests/escape.test.ts`, `tests/measures.test.ts`, `tests/eventStaleness.test.ts` — synthetic trajectories + edge cases (see Validation).
15. **Offline script** — `scripts/validate-events-offline.mjs` — run detectors on persisted or synthetic tracks without browser.
16. **Playwright** — `scripts/validate-ms5.mjs` + `npm run validate:ms5`.
17. **Remove MS-5 placeholder** — Replace `ms5-event-note` in `CorrectionCleaningPanel` with link/panel entry point.

---

## Validation

### Tier 1 — Unit tests (must pass)

| # | Case |
|---|---|
| U1 | Investigation dwell uses Δ`timeUs`, not frame count — variable spacing fixture (`test51`-like). |
| U2 | Body-only proximity creates `low`/`medium` confidence investigation; never fabricates nose. |
| U3 | Merge same-hole segments across brief out-of-zone gap ≤ `investigationMergeGapUs`. |
| U4 | Primary errors exclude target investigations; unavailable when `targetHoleConfirmedAt` null. |
| U5 | Mid-platform `lost` streak → no escape event (Phase A score below censor). |
| U6 | Trailing rim descent synthetic → `escape_censored`, not `escape_entry`. |
| U7 | Recording end during entry → total latency censored, not numeric clip duration. |
| U8 | Protocol cutoff before recording end → censor reason `protocol_cutoff`. |
| U9 | Duplicate adjacent `timeUs` — path length skips zero-Δt; dwell deduped. |
| U10 | Stale cleaning → measures use corrected-only + `trajectory_basis` flag. |
| U11 | Manual event reject → excluded from error count. |
| U12 | Strategy override persists and replaces auto class in measures. |
| U13 | Rejected auto investigation → auditable, not counted. |

### Tier 2 — Synthetic fixtures

| Fixture | Purpose |
|---|---|
| `spatial_direct.json` | Center start → target investigation, high DI → spatial |
| `serial_ring.json` | Sequential hole visits → serial |
| `random_crossing.json` | Center crossings, many holes → random |
| `false_escape_mid_platform.json` | Lost mid-platform → no escape |
| `censored_end_descent.json` | Rim shrink pattern → escape_censored |
| `unknown_target.json` | Investigations ok; errors/latency unavailable |

### Tier 3 — Automated browser (`validate:ms5`)

| # | Criterion |
|---|---|
| V1 | After tracking + confirm target on test53, event detection runs; ≥ 1 investigation visible. |
| V2 | Changing investigation dwell threshold changes event count (snapshot compare). |
| V3 | Total latency shows **censored** on all three clips (not “never escaped”, not bare duration). |
| V4 | Mid-platform flagged `lost` frame not linked to escape event. |
| V5 | Manual add investigation → persists after reload → error count updates. |
| V6 | Confirm/reject changes measure error count. |
| V7 | Strategy reasoning visible; override persists. |
| V8 | Target unknown → primary errors/latency unavailable with explanation. |
| V9 | Stale cleaning banner; measures still compute on corrected-only. |
| V10 | MS-1–MS-4 regression scripts remain green. |

### Tier 4 — Manual review (scientist)

- Inspect test53 end-of-clip: escape censored with progressive evidence shown, not “never escaped”.
- Inspect test51: investigations detected despite low calibration confidence; no false escape from cylinder era.
- Change investigation threshold: event list updates live.
- Confirm manual investigation on a missed hole: errors update.
- Verify times match container timestamps on `test51` non-integer spacing.

---

## Decisions requiring your approval

| ID | Question | Recommendation | Tradeoff |
|---|---|---|---|
| **Q1** | Primary latency anchor: first target **investigation** vs first **proximity**? | Investigation (D5-A) | Investigation matches operational “visit”; proximity is noisier on fly-bys |
| **Q2** | Count re-visits to same wrong hole as separate errors? | Yes (D7) | Matches clicker; may inflate vs some papers |
| **Q3** | Target-centered quadrant vs fixed compass (N/E/S/W)? | Target-centered (D6) | Standard in Barnes literature; unusable until target confirmed |
| **Q4** | Phase B pixel fetch for escape evidence in MS-5? | Yes, bounded window (D4) | +complexity; required to pass false-escape validation on rim exploration |
| **Q5** | Default measurement trajectory: cleaned-if-consumable else corrected? | Yes (D2) | Labs wanting raw-only must wait for MS-6 export toggle |
| **Q6** | Auto-run event detection after tracking completes? | Yes, with “Re-detect events” button | Faster demo; scientist may prefer manual trigger only |
| **Q7** | Auto events default `proposed` vs auto-`confirmed`? | `proposed` until confirmed (D9) | Safer science; more clicks |
| **Q8** | `escape_censored` as event type vs measure-only flag? | Both: event record + censored measure (D4) | Slight redundancy; makes timeline and export clearer |
| **Q9** | Minimum investigation confidence for error/latency counting? | Count all non-`rejected`; weight display by confidence | Excluding `low` reduces false errors but hides body-only visits |
| **Q10** | Strategy classifier: require center start for spatial? | Yes; flag assumption if not (D8) | test53 starts near rim → likely random/flagged, not spatial |

---

## Repository-specific recommendations

1. **Reuse `TRACKING_HOLE_PROXIMITY_FRACTION` (0.12) as escape proximity default**, but use **tighter** nose investigation default (0.10) — investigations should be stricter than escape censoring.
2. **Do not promote MS-3 `absent_in_hole` to escape** — use it as a hint to start Phase B fetch near trial end only when target confirmed.
3. **Wire event staleness into the same store paths as cleaning** (`confirmGeometry`, `setTrialWindow`, etc.) — pattern already proven in MS-4.
4. **Keep detectors pure functions** — `detectEvents(observations, geometry, window, params)` — enables offline validation without Playwright for scientific core.
5. **Defer export and D3 visualizations to MS-6** — MS-5 UI is review-first: list + numbers + evidence, not figures.
6. **Do not store blob area on every observation retroactively** — fetch on demand for escape candidates only; avoids MS-3 migration churn and keeps raw layer unchanged.
7. **Explicit copy for sample clips:** UI should say “Recording ended during hole entry — total latency censored” rather than “mouse never escaped.”

---

## Known limitations (expected after MS-5)

- Body-only investigations near rim when nose absent (common) — confidence tier communicates uncertainty.
- Escape completion threshold may never fire on supplied clips — censored outcomes are correct, not failures.
- Hole-darkening signal weak when compression artifact dominates — combined score reduces weight; manual escape marking available.
- Search strategy automation will disagree with human raters — overrides are first-class.
- Path length excludes gaps without body points — flagged in assumptions; cleaning optional fill does not hide gap spans in assumptions.

---

## Completion criteria (for future MS-5 sign-off)

MS-5 is complete when:

1. All Tier 1 unit tests and Tier 3 Playwright criteria pass on all three clips.
2. Manual review confirms censored total latency and no false mid-platform escapes.
3. Threshold changes visibly alter events; manual overrides persist and recompute measures.
4. MS-1–MS-4 regression suite green.
5. Constitution MS-5 validation paragraph satisfied.
6. `AI_NOTES.md` updated with any approved Q1–Q10 decisions and validation evidence.

**Do not mark complete or merge until explicit review after implementation.**
