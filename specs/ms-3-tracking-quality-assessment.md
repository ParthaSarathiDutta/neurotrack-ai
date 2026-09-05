# MS-3 — Tracking & Quality Assessment

Branch: `ms-3-tracking-quality-assessment`
Base: `main` @ `7bdcfd2` (MS-1 and MS-2 complete)
Constitution reference: `specs/constitution.md` → MS-3
Status: **Design only — not implemented, not approved for coding yet.**

## Inspection summary

Before writing this spec, the following were read: `specs/constitution.md` (mission, principles, sample-data findings, roadmap, data-model contracts, validation gates), `reference/task-01-barnes-maze.md`, `reference/sample-data.md`, `specs/ms-1-foundation-ingest-persistence.md`, `specs/ms-2-review-player-maze-calibration-trial-window.md`, and the current source tree: `src/domain/types.ts`, `src/domain/constants.ts`, `src/domain/timing.ts`, `src/domain/migration.ts`, `src/domain/trialFactory.ts`, `src/domain/calibration/*` (`otsu.ts`, `connectedComponents.ts`, `circleFit.ts`, `ringFit.ts`, `refineHoles.ts`, `detectMaze.ts`, `calibrationQuality.ts`), `src/domain/trialWindow/motionOnset.ts`, `src/workers/{ingest,frame}-worker.ts` and `mp4-utils.ts`, `src/services/{calibrationService,trialWindowService,frameService,templateService,ingestService}.ts`, `src/store/sessionStore.ts`, `src/db/{database,videoCache}.ts`, `src/components/{ReviewView,CalibrationPanel,TrialWindowPanel,VideoPlayer,VideoOverlay}.tsx`, `scripts/{validate-ms1,validate-ms2,validate-calibration}.mjs`, existing `tests/*.test.ts`, and `AI_NOTES.md`.

Key findings that shape this spec:

1. **The constitution already fixes the `Observation` contract** (`timeUs, bodyXY?, noseXY?, confidence, observed: 'tracked'|'absent_in_hole'|'absent_pre_trial'|'lost', origin: 'auto'|'interpolated'|'smoothed'|'manual'`) and the `Trial` contract's `track` field name. MS-3 must implement this contract as written, not invent a different shape.
2. **MS-2 already hit the exact "per-trial state leakage" bug class twice** (see `AI_NOTES.md`, "MS-2 final correctness"): a global Worker singleton with no fingerprint/op-sequence guard leaked a different trial's results into the active trial after switching. MS-3's tracking worker/store action must use the same `opSeq` + `fingerprint` guard pattern from day one (`sessionStore.ts`'s `runAutoDetect`/`proposeWindow`), not retrofit it after a bug report.
3. **Calibration already gives MS-3 a validated platform ROI** (`Geometry.platformCenter`, `platformRadiusPx`, `holes[]`, `targetHoleId`) and **the trial window already gives a validated start boundary** (`TrialWindow.startTimeUs`, confirmed or proposed). MS-3 must depend on these outputs, not re-detect the platform or re-guess trial start.
4. **The existing calibration pipeline already contains most of the classical CV primitives MS-3 needs**: Otsu thresholding (`otsu.ts`), 4-connected blob extraction with area/compactness (`connectedComponents.ts`), and a confidence-tier pattern driven by measured residuals (`calibrationQuality.ts`). MS-3 reuses these functions directly rather than reimplementing background subtraction or morphology from scratch.
5. **The ingest worker already proves the perf-relevant pattern**: WebCodecs decode-to-completion across all 5,539 frames of `test50` without retaining `VideoFrame`s, at 190–430× real-time (Phase 0 spike). MS-3's tracking worker reuses this "decode, process, close, discard" pattern instead of buffering the video.
6. **No `Observation`/`Track` types exist yet anywhere in the codebase.** MS-3 is the first milestone to add them — there is nothing "existing" to be consistent with here beyond the constitution's contract itself.

---

## Requirements

### A. Background / foreground modeling

| # | Requirement |
|---|---|
| RA1 | Build a per-pixel background model from frames sampled inside the trial window, because intra-platform lighting is measurably uneven (constitution finding: quadrant means differ 17–21 gray levels) and a single global threshold is known not to work. |
| RA2 | Foreground segmentation is a per-pixel absolute-difference-from-background test, thresholded, restricted to the platform ROI (`Geometry.platformCenter`/`platformRadiusPx`) so rig hardware, cables, and out-of-platform motion never enter consideration. |
| RA3 | Reuse the existing Otsu/connected-components primitives (`otsu.ts`, `connectedComponents.ts`) for thresholding and blob extraction rather than introducing a second implementation. |
| RA4 | Candidate blobs are filtered by size and shape scaled to the trial's own measured platform radius (never a fixed pixel constant), so the pipeline generalizes to differently-zoomed rigs the way calibration's hole-area heuristic already does. |
| RA5 | Reject non-animal foreground objects — most concretely `test51`'s ~3,200 px start cylinder (~4× the animal's median blob area) — on size, not on filename or frame index. |
| RA6 | No ML model, no training step, no server-side or hosted CV call. Classical background subtraction is used unless MS-3's own validation shows it demonstrably fails on one of the three clips (see "Non-goals" for the ML fallback trigger condition). |

### B. Animal position & pose

| # | Requirement |
|---|---|
| RB1 | Every tracked frame reports a body position (blob centroid). |
| RB2 | A nose/head estimate is attempted from blob geometry (principal-axis extremity + recent heading), not fabricated when unreliable — see D6. |
| RB3 | When heading is ill-defined (animal stationary, blob near-circular/curled) or the blob is rim-clipped, the nose estimate is omitted (`null`) rather than guessed, and this is recorded as a distinct quality flag, not a silent gap. |
| RB4 | Every observation carries a numeric `confidence` (RB1's body point) and, when present, an implicit nose confidence via the `ambiguous_head_tail` flag — both are relative plausibility scores, not calibrated probabilities, and are documented as such. |
| RB5 | The tail must not distort the body point: centroid computation and size filtering operate on the whole blob, but pose disambiguation must not treat the elongated tail extremity as the head under normal heading conditions (see D6). |

### C. Per-frame observation status

| # | Requirement |
|---|---|
| RC1 | Every frame in the trial's `timestampIndex` gets exactly one `Observation` row — no frame is silently skipped or omitted. |
| RC2 | `observed` uses exactly the constitution's four values (`tracked`, `absent_in_hole`, `absent_pre_trial`, `lost`); MS-3 does not invent additional top-level statuses. |
| RC3 | Finer-grained conditions (low confidence, possible occlusion, ambiguous head/tail, implausible jump, near-hole disappearance) are expressed as non-authoritative `qualityFlags` layered on top of `observed`/`confidence`, never as a fifth `observed` value. |
| RC4 | `origin` is always `'auto'` for everything MS-3 writes; `'interpolated'` / `'smoothed'` / `'manual'` are reserved for MS-4 and must not appear from this milestone's pipeline. |
| RC5 | A tracker losing the animal (`lost`) and the animal plausibly entering the escape hole (`absent_in_hole`) must never be indistinguishable to downstream code — this is the constitution's explicit non-negotiable for this milestone. |

### D. Tracking quality assessment

| # | Requirement |
|---|---|
| RD1 | Produce a per-trial `TrackQuality` summary: tracked/lost/absent-in-hole fractions, longest lost gap, low-confidence count, implausible-jump ("speed outlier") count, and a bounded list of flagged frames for review. |
| RD2 | Produce an overall tri-level assessment (`high`/`low`/`failed`) from the same metrics, mirroring the calibration confidence-tier pattern already validated in MS-2 — not a new, differently-shaped signal. |
| RD3 | Every quality metric must be traceable to a concrete, inspectable definition (no metric invented purely to look sophisticated). |
| RD4 | The quality report must be visible before the scientist is asked to trust any downstream number — matches the constitution's "read a quality report" step in the end-to-end user outcome. |

### E. Gap handling (no silent interpolation)

| # | Requirement |
|---|---|
| RE1 | MS-3 performs **no interpolation, smoothing, or gap-filling** of any kind. Every gap (`lost`, `absent_in_hole`) is stored exactly as observed. Trajectory cleaning is MS-4's explicit mandate per the constitution's roadmap and must not be pulled forward. |
| RE2 | Implausible frame-to-frame jumps are **flagged**, never corrected or dropped. The raw (possibly-wrong) observation is preserved; only a diagnostic flag is added. |
| RE3 | Isolated single-frame gaps and long multi-second gaps are recorded identically as consecutive `lost`/`absent_in_hole` runs — MS-3 does not apply different logic to "short" vs. "long" gaps beyond what the quality report's "longest gap" metric already surfaces for the scientist's attention. |

### F. Timing fidelity

| # | Requirement |
|---|---|
| RF1 | `Observation.timeUs` comes from the trial's existing `timestampIndex`; no frame-rate assumption, integer or otherwise, is used anywhere in the tracking path. |
| RF2 | `test51`'s non-integer container timing (`15000/1001`) continues to produce correct, non-uniform frame-to-frame time deltas in every derived quantity (implausible-jump speed uses real Δt, not an assumed Δt). |
| RF3 | Tracking is scoped to the trial's confirmed (or accepted-proposed) window; pre-window frames get `absent_pre_trial` without running any CV on them (cheap, and correct — the constitution's frozen pre-trial segment has nothing to track). |

### G. Per-trial isolation & persistence

| # | Requirement |
|---|---|
| RG1 | `Track` (observations + quality + params + status) is stored on the owning `TrialRecord` and persists through the existing Dexie session/`migration.ts` pipeline exactly like `Geometry`/`TrialWindow`. |
| RG2 | Running tracking on trial B must never write into, read from, or display trial A's `Track`, even under rapid trial switching — enforced with the same `opSeq` + `fingerprint` guard already proven in `sessionStore.ts` for calibration and trial-window detection. |
| RG3 | Switching away from a trial mid-tracking-run does not corrupt state; the in-flight run either completes and is discarded (if the trial is no longer selected/relevant) or is cancellable. |
| RG4 | Reloading the page after a completed tracking run restores the identical `Track` for the correct trial. |

### H. Scientist review handoff

| # | Requirement |
|---|---|
| RH1 | The quality report's flagged-frame list is click-through: selecting a flagged frame seeks the existing MS-2 player to that exact frame (`useVideoPlayer`'s `loadFrame`/`seekToTimeUs`), reusing player infrastructure rather than building a second seek path. |
| RH2 | The current frame's body/nose observation is rendered on the existing `VideoOverlay`, styled by `observed` status using shape/marker distinctions, not color alone (accessibility baseline carried forward from MS-1/MS-2). |
| RH3 | MS-3 does **not** implement point editing, event creation, or trajectory correction UI. It hands off a navigable, explained list of problems; MS-4 builds the correction surface on top of it. |

### I. Performance & worker architecture

| # | Requirement |
|---|---|
| RI1 | Tracking runs in a dedicated Worker, reusing `mp4-utils.ts`'s demux/decoder-config extraction exactly as `ingest-worker.ts` and `frame-worker.ts` already do. |
| RI2 | Decoded pixel buffers for the full video are never retained simultaneously. At most the background-model image, the current frame's buffer, and the small `Observation` record for that frame are alive at once — matching `ingest-worker.ts`'s proven "decode → measure → close → discard" pattern, not `frame-worker.ts`'s LRU cache (which is designed for interactive stepping, not a sequential full pass). |
| RI3 | Progress is reported periodically (mirroring `ingest-worker.ts`'s `progress` message every 200 frames) so the UI can show a progress bar without polling per-frame. |
| RI4 | A running tracking pass is cancellable; cancellation stops the decode loop and leaves whatever `Track.status` reflects a clean `'cancelled'` state rather than a partial silent success. |

### J. UI/UX

| # | Requirement |
|---|---|
| RJ1 | New controls follow the existing "panel + actions row + Technical details disclosure" convention (`CalibrationPanel.tsx`, `TrialWindowPanel.tsx`), not a new visual language. |
| RJ2 | New controls are keyboard reachable, labeled, and usable at 200% zoom, per the accessibility baseline carried through every prior milestone. |
| RJ3 | Progress and quality state use `data-testid`s following the existing naming convention, for Playwright validation. |

---

## Decisions

### D1 — `Observation`/`Track` implement the constitution's contract literally

`observed`, `origin`, `timeUs`, `bodyXY?`, `noseXY?`, `confidence` are implemented exactly as already specified in `specs/constitution.md`'s data-model contracts section. `TrialRecord` gains a `track: Track | null` field, matching the constitution's `Trial → ... track, events, measures` contract. This is not a new design decision so much as executing on a contract that predates this spec.

### D2 — Tracking is gated on MS-2's confirmed outputs, not re-derived

Running tracking requires `trial.geometry.confirmedAt != null` (a validated platform ROI exists) and `trial.trialWindow.startTimeUs != null` (a start boundary exists, confirmed or accepted-proposed). If either is missing, the UI blocks with an explicit message ("Confirm maze geometry and trial window before tracking") instead of guessing a platform position or measuring from `t=0` — the exact mistake the constitution's finding #1 warns against for latency.

### D3 — Background model reuses `medianGrayscaleFrame`, sampled from inside the trial window

A per-pixel median of `N` frames (initial value: 30, tunable, exposed in `TrackingParams`) evenly sampled across `[startTimeUs, endTimeUs]` — reusing `medianGrayscaleFrame` from `otsu.ts` verbatim, the same function calibration already validated for reference-frame noise cancellation. Risk: if the animal spends a large fraction of the window in one location, the median can show a faint ghost at that location; this is called out as a known risk (below) to validate against on all three clips, not pre-solved speculatively with a more complex running/adaptive model before evidence says the simple one fails.

### D4 — Foreground mask is threshold-on-difference, restricted to the platform circle

`|pixel − background| > threshold`, evaluated only for pixels within `platformRadiusPx` of `platformCenter` (a trivial circular mask, already the shape used throughout calibration). Threshold starts from an Otsu split of the difference image itself (reusing `otsuThreshold`) rather than a fixed gray-level constant, matching the "detected per video" principle.

### D5 — Blob plausibility is relative to the trial's own measured platform radius

Minimum/maximum candidate blob area are expressed as fractions of `π · platformRadiusPx²` (initial values validated during implementation against the constitution's measured ~600–750 px median animal blob at `platformRadiusPx ≈ 204–218`, and against the ~3,200 px start-cylinder outlier on `test51` that must fall outside the accepted band). Exact fractions are implementation-time constants in `domain/constants.ts`, validated against all three clips — never a bare pixel literal, and never a per-filename branch.

### D6 — Head/nose from principal-axis extremity + heading, with an explicit no-guess fallback

For the selected blob: compute the centroid (body point) and the blob's principal axis from its pixel set (reusing the already-available `Blob.pixels` from `connectedComponents.ts` — no new contour extraction primitive needed). The two axis extremities are disambiguated as head vs. tail using (a) consistency with the recent-frame heading (constant-velocity direction from the last few tracked centroids) and (b) local width near each extremity (the tail is characteristically thin; the head end is wider) as a tie-breaker. If recent heading is near-zero (animal stationary or just re-acquired) or the blob's axis ratio is close to circular (no reliable long axis), `noseXY` is `null` and `ambiguous_head_tail` is set — this is the explicit fallback required by the task brief rather than a fabricated point. This resolves the constitution's previously-open "nose vs. body from geometry alone" question using only pixel/geometry evidence already available in the codebase; an ML pose-estimation step remains the documented, deferred fallback if this proves insufficient (see Non-goals).

### D7 — `absent_in_hole` is a per-frame local hypothesis, not an escape event

When a previously-tracked blob is no longer found near its last known (predicted) position, MS-3 distinguishes two cases using only per-frame local evidence:

- If the last known position was near the **target hole** when known (`geometry.targetHoleId`/`proposedTargetHoleId`), or otherwise near the platform rim generically when the target is not yet known, **and** the last few frames before disappearance showed shrinking blob area and/or slowing motion (a light version of the constitution's escape evidence, not the full combination) → `absent_in_hole`.
- Otherwise (disappearance mid-platform, or with no such preceding pattern) → `lost`.

This is explicitly labeled everywhere (spec, code comments, UI copy) as a **provisional per-frame status**, not a scientific escape claim — full evidence-based escape detection and event timing is MS-5's job. This satisfies the constitution's requirement that tracker loss and hole entry "must never look the same to downstream code" without pulling MS-5's event-detection scope forward. Non-target holes are known dead ends per `reference/task-01-barnes-maze.md` and `reference/sample-data.md` ("one hole leads to escape... the rest open onto nothing"), so proximity to a *non-target* hole alone is never sufficient grounds for `absent_in_hole`.

### D8 — Confidence is a relative plausibility score, documented as such

`confidence = clamp(0.5 · sizeScore + 0.5 · continuityScore, 0, 1) × occlusionPenalty`, where `sizeScore` measures closeness to the plausible blob-area band, `continuityScore` measures closeness to the constant-velocity-predicted position, and `occlusionPenalty` reduces confidence for blobs clipped by the frame edge or overlapping a hole-ring band. This is explicitly documented in the UI ("Technical details") and this spec as a **relative comparator**, not a calibrated statistical probability — consistent with "never fabricate precision."

### D9 — `Track` state isolation reuses the exact MS-2 fix pattern

`sessionStore.ts` gains `runTracking(trialId)` / `cancelTracking(trialId)` using the same `let trackingOpSeq = 0` monotonically-incrementing sequence number and post-await `fingerprint` re-check already used by `runAutoDetect`/`proposeWindow`. This is a direct, deliberate reuse of a fix that was needed twice already in MS-2 (see `AI_NOTES.md`) — it is designed into MS-3 from the first commit, not discovered later by manual review.

### D10 — Tracking worker follows `ingest-worker.ts`'s memory shape, not `frame-worker.ts`'s

A new `src/workers/tracking-worker.ts` demuxes and decodes sequentially across the trial window exactly like `ingest-worker.ts` (decode → use output → `frame.close()` → discard), never retaining more than the current frame. `frame-worker.ts`'s LRU `ImageBitmap` cache is for interactive stepping and is the wrong shape for a sequential full-window pass over up to 5,539 frames (`test50`) — reusing it here would risk multi-gigabyte retention exactly as flagged in the performance requirement.

### D11 — No ML model unless classical tracking demonstrably fails

Per the constitution's "Deliberately not chosen — GPU or in-browser ML model — held in reserve if geometric nose estimation proves insufficient during MS-3," MS-3 ships the classical pipeline (D3–D6) first. The trigger for revisiting this decision is empirical: if the offline diagnostic script (`scripts/validate-tracking.mjs`) or manual visual review shows nose estimation or blob selection is unusable (not merely imperfect) on one of the three clips after tuning D5's thresholds, that finding is recorded and an ML fallback is scoped as follow-up work — not built speculatively now.

### D12 — `AnalysisParams` gains session-level tracking defaults; `Track.params` records what actually ran

The constitution's `AnalysisParams → tracking, cleaning, event thresholds, ...` contract is honored by adding a `tracking: TrackingParams` field to `AnalysisParams` (session-level defaults, editable later if MS-3's validation shows fixed defaults are insufficient). Each `Track.params` snapshot records the exact parameters used for that trial's last run, independent of later default changes — the same "what actually produced this value" provenance discipline already used by `Geometry.detection`.

---

## Plan

1. **Data model.** Add `Observation`, `ObservedStatus`, `ObservationOrigin`, `ObservationQualityFlag`, `TrackStatus`, `TrackingParams`, `FlaggedFrame`, `TrackQuality`, `Track` to `src/domain/types.ts`. Add `track: Track | null` to `TrialRecord`. Add `tracking: TrackingParams` to `AnalysisParams`. Extend `migration.ts` to backfill `track: null` and default `tracking` params for pre-MS-3 persisted records. Add `createEmptyTrack()` to `trialFactory.ts`.
2. **Tracking constants.** Add relative (fraction-of-platform-radius) blob-size bounds, plausible-speed bound, low-confidence threshold, and background-sample count to `domain/constants.ts`, following the existing calibration-threshold block's style and comments.
3. **Background model module.** `src/domain/tracking/background.ts` — even-time sampling of frame indices across `[startTimeUs, endTimeUs]`, delegating to `medianGrayscaleFrame`.
4. **Foreground/blob module.** `src/domain/tracking/foreground.ts` — per-pixel diff-from-background inside the platform circle, Otsu threshold on the diff image, delegates blob extraction to `findConnectedComponents`.
5. **Blob selection module.** `src/domain/tracking/blobSelection.ts` — plausibility scoring (size band, continuity vs. predicted position), selection of best candidate or "no plausible blob," pure functions operating on `Blob[]` + prior state.
6. **Pose module.** `src/domain/tracking/animalPose.ts` — centroid, principal-axis extremities from `Blob.pixels`, head/tail disambiguation, confidence and nose-fallback logic (D6, D8).
7. **Observation-status module.** `src/domain/tracking/observationStatus.ts` — combines blob-selection outcome, hole-vicinity/disappearance heuristic (D7), and window boundaries into the constitution's `observed` enum plus `qualityFlags`.
8. **Quality module.** `src/domain/tracking/trackQuality.ts` — aggregates an `Observation[]` into `TrackQuality` (fractions, longest gap, flagged-frame list, tri-level assessment), mirroring `calibrationQuality.ts`'s pattern.
9. **Tracking Worker.** `src/workers/tracking-worker.ts` — two-phase: (a) sample+build background, discard sampled frames; (b) sequential decode of the full window, per-frame call into steps 4–7, `frame.close()` immediately, post `Observation` + periodic progress, honor a cancel message. New `TrackingWorkerRequest`/`TrackingWorkerResponse` message types in `domain/types.ts` mirroring the existing `FrameWorker*`/`IngestWorker*` shapes.
10. **Tracking service.** `src/services/trackingService.ts` — spawns/owns the worker, exposes `runTracking(trial, params)` (returns `Track`) and `cancelTracking()`, mirroring `trialWindowService.ts`/`calibrationService.ts` conventions.
11. **Store integration.** `sessionStore.ts` — `runTracking(trialId)` / `cancelTracking(trialId)` using the `opSeq` + `fingerprint` guard pattern (D9); persists `Track` via the existing `patchTrial`/`scheduleSave` flow.
12. **UI — Track Quality panel.** New `TrackQualityPanel.tsx` (Run/Cancel + progress, summary line, tri-level warning box, "Technical details" disclosure, flagged-frame list with click-to-seek), following `CalibrationPanel.tsx`/`TrialWindowPanel.tsx` conventions and `data-testid` naming.
13. **UI — Overlay & timeline.** Extend `VideoOverlay.tsx` to draw the current frame's body/nose markers styled by `observed` (shape, not color alone). Extend `VideoPlayer.tsx`'s existing shaded-region timeline (already used for pre-trial/post-cutoff) with a tracked/lost/absent strip.
14. **Unit tests.** Vitest coverage for background/foreground/blob-selection/pose/quality modules using synthetic pixel-buffer fixtures (no video decode in unit tests), following `ringFit.test.ts`/`motionOnset.test.ts`/`refineHoles.test.ts` conventions. Include a synthetic "cylinder-sized blob at platform center" fixture and a synthetic "thin tail + round head" fixture.
15. **Offline diagnostic script.** `scripts/validate-tracking.mjs` — ffmpeg-based multi-frame extraction across all three real clips (mirroring `validate-calibration.mjs`), running the domain pipeline directly (no browser) for the deterministic/heuristic checks in the Validation section.
16. **Playwright validation.** New `scripts/validate-ms3.mjs` (mirroring `validate-ms2.mjs`'s structure), covering multi-trial switching/isolation, persistence/reload, flagged-frame click-to-seek, progress/cancel UX, and accessibility of new controls.

---

## Data contracts

Additive to `src/domain/types.ts`; nothing existing is removed or renamed.

```ts
export type ObservedStatus = 'tracked' | 'absent_in_hole' | 'absent_pre_trial' | 'lost';
export type ObservationOrigin = 'auto' | 'interpolated' | 'smoothed' | 'manual'; // MS-3 only ever writes 'auto'

export type ObservationQualityFlag =
  | 'low_confidence'
  | 'possible_occlusion'
  | 'speed_outlier'
  | 'ambiguous_head_tail'
  | 'near_hole_disappearance';

export interface Observation {
  timeUs: number;                 // from TimestampIndexEntry — never derived from fps
  frameIndex: number;              // convenience only, matches TimestampIndexEntry convention
  bodyXY: { x: number; y: number } | null;
  noseXY: { x: number; y: number } | null;
  confidence: number;              // 0..1 relative plausibility, meaningful only when bodyXY != null
  observed: ObservedStatus;
  origin: ObservationOrigin;
  qualityFlags: ObservationQualityFlag[] | null; // diagnostic only, never authoritative
}

export type TrackStatus = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

export interface TrackingParams {
  backgroundSampleCount: number;
  minBlobAreaFraction: number;     // fraction of π·platformRadiusPx²
  maxBlobAreaFraction: number;
  maxPlausibleSpeedPxPerSec: number;
  lowConfidenceThreshold: number;
  toolVersion: string;
}

export interface FlaggedFrame {
  frameIndex: number;
  timeUs: number;
  reason: ObservationQualityFlag | 'lost';
}

export interface TrackQuality {
  totalFrames: number;
  trackedCount: number;
  trackedFraction: number;
  lostCount: number;
  lostFraction: number;
  absentInHoleCount: number;
  longestLostGapFrames: number;
  longestLostGapUs: number;
  lowConfidenceCount: number;
  speedOutlierCount: number;
  meanConfidence: number;
  medianConfidence: number;
  overallAssessment: 'high' | 'low' | 'failed';
  assessmentReasons: string[];
  flaggedFrames: FlaggedFrame[];    // bounded (e.g. capped at ~200) for review handoff
}

export interface Track {
  status: TrackStatus;
  observations: Observation[];     // one entry per timestampIndex entry — RC1
  quality: TrackQuality | null;
  params: TrackingParams;
  computedAt: string | null;
  error: string | null;
}
```

`TrialRecord` gains `track: Track | null`. `AnalysisParams` gains `tracking: TrackingParams`. Migration backfills both to sane defaults for pre-MS-3 records.

---

## Validation

No ground-truth animal coordinates exist for any of the three clips (deliberately, per `reference/sample-data.md`). Validation is therefore split into three explicit tiers rather than one blended "accuracy" number.

### Tier 1 — Deterministic software invariants (must always hold exactly)

| # | Criterion | Pass condition |
|---|---|---|
| V1 | Full coverage | `observations.length === timestampIndex.length` for all three clips. |
| V2 | No filename branching | Static check: no `test50`/`test51`/`test53` literals gate tracking behavior (extends MS-2's V15 pattern). |
| V3 | Timing fidelity | Every `Observation.timeUs` matches a real `timestampIndex` entry; `test51` frame-to-frame Δt in speed computations traces to `1001/15000` s, never an assumed fps. |
| V4 | Determinism | Running tracking twice on the same trial with the same params produces byte-identical `Observation[]` (no `Math.random`, no worker-ordering nondeterminism). |
| V5 | No cross-trial leakage | Extends the MS-2 V19 pattern: track trial A, switch to B and track it, switch back to A — A's `Track` is byte-identical to before switching. Reload preserves both independently. |
| V6 | No silent interpolation | Every `Observation.origin === 'auto'`; none is `'interpolated'`/`'smoothed'`/`'manual'` after an MS-3-only run. |
| V7 | Pre-window frames | Every frame before `trialWindow.startTimeUs` is `observed: 'absent_pre_trial'` with both coordinates `null`. |
| V8 | Gating | Running tracking without confirmed geometry or a set trial-window start is blocked with an explicit message, not silently defaulted. |

### Tier 2 — Heuristic sanity checks (thresholds are judgment calls, not accuracy claims)

| # | Criterion | Pass condition |
|---|---|---|
| V9 | Plausible coverage | `trackedFraction` clears a low, explicitly-loose floor (e.g. ≥0.6) on all three clips — framed as "not obviously broken," not "accurate." |
| V10 | Cylinder rejection | On `test51`, no `Observation` in the frames immediately after trial start selects a blob whose area is consistent with the ~3,200 px start cylinder rather than the plausible animal-size band. |
| V11 | Jump-outlier ceiling | `speedOutlierCount / trackedCount` stays below an explicitly-loose ceiling (e.g. ≤0.05) on all three clips. |
| V12 | Quality-report consistency | `trackedCount + lostCount + absentInHoleCount + (pre-trial count) === totalFrames`; `flaggedFrames` is non-empty whenever `overallAssessment !== 'high'`. |
| V13 | Status separation exists | All four `observed` values are producible by the pipeline (unit-test fixtures cover each; at least one real clip exhibits `absent_in_hole` or `lost` beyond the trivial `absent_pre_trial` case). |

### Tier 3 — Manual visual validation (explicitly not automated; must be listed, not faked as pass/fail)

- Scrubbing each of the three clips, does the body marker visibly follow the mouse (not the tail tip, not the cable, not the cylinder)?
- During rim/hole investigations, does the nose marker visibly diverge from the body marker in a plausible way, or does it correctly go `null` when heading is ambiguous?
- Do flagged frames in the quality report visually correspond to genuinely hard stretches (rim occlusion, near-hole disappearance) rather than arbitrary noise?
- Does a frame that looks hard to a human eye tend to carry lower `confidence`?

These four checks require a human looking at the actual overlay and are recorded as **pending manual review** in Completion — never marked "PASS" by a script.

---

## Non-goals / deferred work

Explicitly out of scope for MS-3, per the roadmap and the user's architectural constraint:

- Hole-investigation event detection (MS-5).
- Escape-event evidence combination, timing, and final classification (MS-5) — MS-3 emits only the provisional per-frame `absent_in_hole` hypothesis described in D7, never an "escape" claim.
- Search-strategy classification (MS-5).
- Final behavioral measures (latency, errors, path length, quadrant time) (MS-5).
- CSV/XLSX export (MS-6).
- Manual point/event correction UI and any trajectory editing (MS-4). MS-3 provides navigation and explanation only (RH3).
- Gap filling, smoothing, and outlier correction/removal (MS-4). MS-3 flags; it never fills or corrects (RE1–RE3).
- An ML/pose-estimation model. Deferred unless D11's trigger condition is met during MS-3's own validation; if triggered, it becomes scoped follow-up work, not silently added mid-milestone.
- True low-level decoder-state pause/resume. "Resume" is scoped pragmatically as **re-running from the earliest not-yet-successfully-tracked frame**, since observations are the unit of persisted progress; this is stated explicitly rather than implied to be finer-grained than it is.

---

## Known risks

1. **Head/nose disambiguation from geometry alone is genuinely hard** for a curled or stationary animal, or during rim occlusion — this is the single highest scientific risk in this milestone, matching the constitution's own flagged risk. Mitigation is the explicit no-guess fallback (D6), not a more elaborate heuristic assumed to work without evidence.
2. **The `absent_in_hole` heuristic (D7) is provisional and can misfire** in both directions (false-negative: genuine hole entry mid-platform tracker confusion mislabeled `lost`; false-positive: a rim-adjacent tracker failure mislabeled `absent_in_hole`). This is why it is documented everywhere as a hypothesis for MS-5 to confirm or override, never as a standalone scientific claim.
3. **Median background contamination** if the animal spends a large fraction of the sampled window in one location (D3). Mitigation is validating background quality visually on all three clips before trusting downstream blob selection; a more advanced (e.g. per-pixel mode, or robust-statistics) background model is explicit follow-up work if the simple median is shown to be insufficient, not pre-built speculatively.
4. **Blob-size band tuning is a real balancing act on `test51`**: the start cylinder (~3,200 px) is only a few times the animal's median blob (~600–750 px) at a platform radius (~218 px) that is itself ~6% larger than `test50`/`test53`'s. The relative-fraction thresholds in D5 must be validated empirically against all three clips during implementation, not assumed correct from this spec alone.
5. **Repeat of the MS-2 per-trial-isolation bug class** if D9's guard pattern is skipped or weakened during implementation under time pressure — this happened twice already in MS-2 per `AI_NOTES.md`. It is called out here specifically so it is designed in from the first commit, not discovered by a second manual review.
6. **15-frame keyframe/compression artifacts** (constitution finding #8) could inject diff-image noise into foreground segmentation the same way they did into MS-2's motion-onset detector before that was fixed. Mitigation is the same defensive posture already validated there: single-frame spikes must not survive the connected-components + plausibility-filter + continuity-vs-predicted-position pipeline, but this must be explicitly checked against real decoded frames, not assumed by analogy.
7. **Sequential per-frame decode of up to 5,539 frames (`test50`) inside a sustained tracking pass** has not yet been wall-clock measured for this milestone's actual per-frame CV cost (background diff + connected components + pose), only for raw decode (Phase 0 spike). Progress reporting and a measured `computedAt`/wall-clock time are required outputs so this is verified, not assumed fast because decode alone was fast.

---

## Report

### Proposed tracking algorithm

Per-pixel median background (sampled from inside the trial window, reusing the existing `medianGrayscaleFrame`) → per-pixel absolute-difference-from-background, restricted to the platform circle → Otsu threshold on the difference image → 4-connected blob extraction (existing `connectedComponents.ts`) → plausibility filtering by blob area (fraction of platform area, generalizing past the three sample rigs) and continuity against a constant-velocity-predicted position → best-candidate selection or explicit "no plausible blob."

### Proposed body/head representation

Body = selected blob's pixel centroid. Head/nose = the blob's principal-axis extremity that is (a) consistent with recent heading and (b) locally wider than the opposite extremity (which is characteristically the thin tail). When heading is ill-defined or the blob is too round to have a reliable axis, nose is explicitly `null` with an `ambiguous_head_tail` flag — never a fabricated point.

### Observation-status model

Constitution's exact four-value `observed` enum (`tracked`/`absent_in_hole`/`absent_pre_trial`/`lost`) plus non-authoritative `qualityFlags` (`low_confidence`, `possible_occlusion`, `speed_outlier`, `ambiguous_head_tail`, `near_hole_disappearance`) for finer-grained review signal without inventing new top-level statuses. `absent_in_hole` is a provisional per-frame hypothesis gated on target-hole (or generic rim) proximity plus a pre-disappearance shrink/slow pattern — explicitly not an escape event.

### Quality metrics

Tracked/lost/absent-in-hole fractions, longest lost gap (frames and µs), low-confidence count, speed-outlier count, mean/median confidence, a bounded flagged-frame list, and a tri-level `high`/`low`/`failed` overall assessment mirroring the already-validated calibration confidence-tier pattern.

### Handling of missing frames/gaps

Never filled, never smoothed, never dropped. Recorded exactly as observed (`lost` or `absent_in_hole`), with `origin: 'auto'` throughout MS-3. Gap-filling and smoothing are MS-4's explicit job.

### Validation plan

Three tiers: deterministic invariants (coverage, no leakage, no fps assumptions, determinism, gating — all script-checkable and non-negotiable), heuristic sanity checks (loose, explicitly-not-accuracy floors/ceilings on coverage, cylinder rejection, jump outliers, report consistency), and manual visual validation (overlay plausibility, nose divergence at rim investigations, flagged-frame relevance, confidence intuition) — listed explicitly as requiring a human, never auto-marked "PASS."

### Major technical risks

Head/nose disambiguation under occlusion or stationary posture; the provisional nature of the `absent_in_hole` heuristic; median-background contamination if the animal lingers in one place; empirical tuning of relative blob-size thresholds against `test51`'s brighter, differently-scaled rig; repeating MS-2's per-trial-isolation bug class if the guard pattern is skipped; keyframe-artifact contamination of foreground segmentation; and unmeasured per-frame CV cost across a 5,539-frame sequential pass.

### Estimated implementation task groups

16 groups per the Plan section above: data model, constants, background module, foreground/blob module, blob-selection module, pose module, observation-status module, quality module, tracking Worker, tracking service, store integration, Track Quality panel UI, overlay/timeline UI, unit tests, offline diagnostic script, Playwright validation.

---

## Completion

**Status: Not started.** This document is a design artifact only. No production code has been written or modified for MS-3. Implementation begins only after explicit human review and approval of this spec.
