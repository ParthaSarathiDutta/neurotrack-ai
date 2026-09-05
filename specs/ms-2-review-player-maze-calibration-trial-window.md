# MS-2 — Review Player, Maze Calibration & Trial Window

Branch: `ms-2-review-player-maze-calibration-trial-window`
Constitution reference: `specs/constitution.md` → MS-2
Status: **Implementation complete on branch — pending final manual visual review before merge.**

### Approved clarifications (September 5, 2026)

1. **20-hole assay contract.** NeuroTrack AI targets the standard 20-hole Barnes maze required by the Salk task. Hole count is **not** exposed as a user-configurable product setting. The ring-fit math uses a fixed `HOLE_COUNT = 20` constant (assay contract, not per-filename logic). Avoid brittle filename-specific assumptions; generalize via measured pixel properties.
2. **Template target-hole confirmation.** Maze-template reuse may **propose** the source trial's target-hole position/identity, but the destination trial's target hole must be **explicitly confirmed** by the user before geometry is treated as final. Never silently inherit target-hole identity as experimental truth (`targetHoleConfirmedAt` field required).

This spec was written after re-reading `specs/constitution.md`, `specs/ms-1-foundation-ingest-persistence.md`, `.cursor/rules/project.mdc`, `reference/salk-assignment.md`, `reference/task-01-barnes-maze.md`, `reference/sample-data.md`, `spike/phase-0-decode-timing/results/findings.md`, and the current MS-1 source (`src/domain/*`, `src/store/sessionStore.ts`, `src/db/database.ts`, `src/workers/*`). Frames were re-extracted from all three local sample videos (`data/barnes-maze/{test50,test51,test53}.mp4`) at the pre-trial mark and at ~5–6 s to visually re-confirm the constitution's measured findings before designing against them. That visual check confirmed: all three clips show a 20-hole ring; `test50`/`test53` share one rig and crop with a cable visible at the bottom and an empty platform at t≈0; `test51` uses a different, more centered crop, is visibly brighter, and shows a distinct cylindrical object at platform center at t≈0 that is absent by ~5.5 s; the mouse is a small, high-contrast, tailed blob, off-center in `test53`'s early frame and centered in `test50`/`test51`'s.

---

## Requirements

### A. Review player

| # | Requirement |
|---|---|
| RA1 | Play/pause, and normal-speed playback of the trial's video. |
| RA2 | Timeline scrubbing (drag or click a position on a time ruler). |
| RA3 | Frame-by-frame stepping forward and backward, correct for non-integer container frame rates (`test51` @ 15000/1001). |
| RA4 | Keyboard shortcuts for all of the above, discoverable without a manual. |
| RA5 | Current timestamp displayed in seconds derived from the container's presentation timestamps (`timeUs`), never from an assumed fps. |
| RA6 | A Canvas/SVG overlay that stays pixel-aligned with the currently displayed video frame across resize, fullscreen, and 200% browser zoom. |
| RA7 | The player must not reconstruct scientific time from nominal fps; every displayed/stored time must trace to an entry in the MS-1 `timestampIndex`. |

### B. Automatic maze calibration

| # | Requirement |
|---|---|
| RB1 | Detect the platform automatically from pixel data (no user click required to start). |
| RB2 | Identify hole candidates and fit a 20-hole ring; derive platform center, radius, and hole positions from the ring, not the bright-region centroid. |
| RB3 | Render the fitted geometry as an overlay on the paused frame used for detection. |
| RB4 | Let the user confirm the whole result in one action when it looks correct. |
| RB5 | Let the user nudge any individual hole, and re-set target hole, without redoing the whole fit. |
| RB6 | Let the user select the target hole. |
| RB7 | Let the user enter the real platform diameter in centimeters and derive `pxPerCm`. |
| RB8 | Degrade honestly and offer a low-click manual fallback when automatic detection fails or is ambiguous — never silently guess. |
| RB9 | No filename-specific behavior; behavior must be driven by pixel measurements taken from each video. |

### C. Maze-template reuse

| # | Requirement |
|---|---|
| RC1 | A calibrated trial's geometry can be offered as a starting point for another trial in the same session. |
| RC2 | Applying a template must reduce clicks relative to calibrating from scratch on a typical case. |
| RC3 | The template must be aligned to the destination video, not blindly copied in absolute pixel coordinates. |
| RC4 | The user must confirm or correct the aligned result before it is treated as final. |
| RC5 | Per-trial geometry provenance (which trial supplied the template, if any) must be retained. |
| RC6 | Template reuse must work, or fail visibly and safely, when the destination camera position/framing differs moderately (the `test51` vs. `test50`/`test53` case). |

### D. Trial window

| # | Requirement |
|---|---|
| RD1 | Propose a trial start automatically from motion onset (or equivalent motion evidence), not from blob presence. |
| RD2 | Correctly handle the ~5 s frozen pre-trial segment present in all three clips. |
| RD3 | Never treat `test51`'s static start cylinder as motion or as the animal. |
| RD4 | Let the user edit start and end directly (scrub-and-set, not just accept/reject). |
| RD5 | Support a configurable, persisted protocol cutoff (seconds from confirmed start). |
| RD6 | Visually mark pre-trial and post-cutoff regions on the timeline. |
| RD7 | Persist the confirmed trial window so downstream latency math (MS-5) uses confirmed start, never video `t=0`. |

### E. UI/UX

| # | Requirement |
|---|---|
| RE1 | The natural flow is: select trial → review video → confirm maze → choose target/scale → confirm trial window. |
| RE2 | Preserve MS-1's visual style and accessibility posture (keyboard reachable, focus visible, no color-only meaning, 200% zoom safe). |
| RE3 | Low-level implementation/debug detail lives under a "Technical details"-style disclosure, consistent with the MS-1 pattern. |
| RE4 | Auto-detected vs. manually-corrected geometry must be visually distinguishable without relying on color alone. |
| RE5 | Clear per-trial status/progress indication (e.g., "needs review" → "geometry confirmed" → "window confirmed"). |

### F. Data contracts

| # | Requirement |
|---|---|
| RF1 | Extend `Geometry` and `TrialWindow` (constitution contracts) with fields needed for per-hole provenance, template reuse, and proposed-vs-confirmed trial window, without breaking MS-1's shape or persisted records. |
| RF2 | Old (MS-1-only) persisted trial records must hydrate cleanly with sane defaults for new fields. |

### G. Validation

See [Validation](#validation) below for the full, numbered list with pass/fail criteria.

---

## Decisions

### D1 — Player: hybrid `<video>`+rVFC for playback, Worker-decoded frames for stepping

Continuous playback and scrubbing use `<video>` + `requestVideoFrameCallback`, per the constitution and the Phase 0 spike (`spike/phase-0-decode-timing/results/findings.md`): `mediaTime` is a genuine presentation timestamp, and this is the only place `<video>` needs to be (WebCodecs `VideoDecoder`/`VideoFrame` cannot exist off a `HTMLVideoElement`, but `HTMLVideoElement` itself is main-thread-only).

Single-frame **stepping** does not reuse `<video>.currentTime` seeking as its primary mechanism. Phase 0 only measured continuous playback (rVFC delivered 5338/5539 callbacks on `test50` at 1×, with zero speedup at 4× — see findings, "4× playbackRate experiment"); it never measured the precision or latency of repeated discrete seeks to arbitrary non-keyframe targets, which is what stepping requires roughly 5,000 times on `test50`. Repeated `<video>` seek-and-confirm cycles are a plausible source of both incorrectness (browsers are not contractually required to seek to the exact requested frame) and poor interactivity (seek latency compounds when stepping quickly).

Decision: stepping uses the **same WebCodecs decode path already built for MS-1 ingest**. On entering the review player, the trial's video is decoded once in the ingest Worker into a bounded-memory frame cache:
- Decode to `VideoFrame`s, draw each to an `OffscreenCanvas` at a capped resolution (native 640×480 for these clips is already small), encode as compressed `ImageBitmap`-backed thumbnails is unnecessary at this resolution — hold recent/nearby frames as real `ImageBitmap`s in an LRU ring buffer (e.g., ±150 frames around the current position, config­urable, bounded in bytes not just count) rather than all 5,539 frames resident at once.
- A step request first checks the ring buffer; on miss, decode is restarted from the nearest preceding sync sample (`is_sync`, at most 15 frames back per `sample-data.md`'s stated keyframe interval) and fast-forwarded to the target — cheap given the measured 190–430× real-time throughput.
- `<video>` stays paused and hidden during stepping; the overlay canvas draws the cached `ImageBitmap` directly. Play/scrub switches back to `<video>` + rVFC.

This keeps the two roles cleanly separated: `<video>`+rVFC for the interactive, real-time-feeling surface (exactly what Phase 0 validated), and the already-validated Worker decode path for exact, reproducible frame access (exactly what MS-1 already validated for ingest). Every displayed frame — from either path — is identified by its `timeUs` from the MS-1 `timestampIndex`, never by a seek target or a frame-index guess.

**Risk flagged, not hidden:** this is new engineering scope beyond a naive `<video>`-only player. It is justified because "manual correction is mandatory" (constitution, MS-4) will depend on this same stepping mechanism, and getting it wrong there is worse than paying for it now. Alternative considered and rejected: pure `<video>` seeking with a "best effort" badge when the presented frame doesn't match the request — rejected because silently accepting whatever frame the browser lands on for a *frame-accurate* correction tool violates "never fabricate" in spirit (the user would be looking at, and correcting, the wrong frame without being told).

### D2 — Overlay coordinate system

The overlay Canvas is sized in CSS pixels to exactly match the rendered `<video>`/frame-canvas box (computed via `getBoundingClientRect`, re-computed on `ResizeObserver`, `devicePixelRatio` change, and fullscreen toggle — 200% zoom is a `devicePixelRatio`/viewport change, not a special case). All geometry, holes, trajectory, and trial-window markers are stored in **native video pixel space** (0..640, 0..480 for these clips, but never hard-coded) and transformed to CSS pixel space through one shared `videoToDisplay(x, y)` function backed by the current rendered box. No component computes its own scale factor.

### D3 — Maze calibration algorithm

Reuses the constitution's already-stated pipeline (Otsu platform mask → dark-blob hole candidates → least-squares ring fit), made concrete:

1. **Reference frame.** Take the median of several frames sampled from the pre-trial window identified by D5 below (or, if trial-window detection hasn't run yet, the first ~2 s of the clip, which is always inside the frozen segment per the constitution's finding). Using a median of several frames — not a single frame — cancels the 15-frame compression-artifact noise (constitution finding #8) without needing motion information.
2. **Platform mask.** Otsu threshold the reference frame; take the largest bright connected component as a *rough* platform mask. Its centroid and radius seed the search window for step 3 only — never the final center (constitution finding: bright centroid is offset ~7 px from the true center by the lighting gradient).
3. **Hole candidates.** Within a radial band around the rough center (≈0.75×–1.05× rough radius), find dark connected components below the Otsu threshold, filtered by size (a configurable expected-hole-area range, seeded from the rough radius so it scales with zoom, not a fixed pixel constant) and compactness (roughly circular). This band excludes both platform-center objects (the `test51` start cylinder) and most rim-adjacent mouse positions, because the reference frame is taken from the frozen pre-trial window where the animal has not yet appeared or moved (D5) — the one clip where the animal is visible at t≈0 under a cover (`test51`) has that object at the center, not the rim.
4. **Ring fit.** Least-squares circle fit (algebraic/Kasa fit refined by one Gauss-Newton pass) to the candidate centroids gives a refined `(center, radius)` for the hole ring — this is the authoritative center, per constitution.
5. **Angular phase.** Sort candidates by angle about the refined center; fit a single rotation offset that best matches a uniform 20-point comb (18.0° spacing, matching the constitution's measured 18.0° ± 0.6°). This yields 20 modeled hole positions even if fewer than 20 candidates were confidently detected.
6. **Per-hole provenance.** Each of the 20 modeled positions is marked `source: 'detected'` if a real candidate blob matched it within tolerance, or `source: 'model'` if its position came only from the ring model (no direct blob evidence) — see [Data contracts](#data-contracts). This is how "20/20 detected" and "17 detected, 3 modeled — please check" are told apart honestly instead of both silently becoming "20 holes."
7. **Platform edge radius (for scale).** Using the refined center from step 4 (not the biased bright centroid), scan outward along many angles and find the bright→dark transition; average the transition radius across angles that don't cross a hole notch. This is `platformRadiusPx`, used with the user-entered diameter (cm) for `pxPerCm` — kept distinct from the hole-ring radius, because the ring sits inset from the physical platform edge and the diameter the user is asked for is the platform's, not the ring's.
8. **Acceptance / fallback.** If candidate count falls far outside a sane range (e.g., <14 or >26 before ring-fitting), or the ring-fit residual is large, or the platform mask isn't found at all, calibration is reported as failed rather than forced — the UI drops to the manual fallback (D4) with whatever partial result exists shown for reference, clearly labeled unconfirmed.

This generalizes past the three sample clips because every threshold above is derived from the reference frame's own measured intensities and rough platform scale, not a fixed gray-level or fixed pixel radius. It is validated, not just designed, against `test50`/`test51`/`test53` (see [Validation](#validation)); genuinely different rigs (different hole count, extreme lighting) remain a residual risk — see the [report](#risk-summary) below and D8.

### D4 — Manual fallback is also low-click

If automatic detection fails, is rejected by the user, or the user simply prefers manual entry: the user clicks the platform center, drags to set radius (2 actions), then clicks **one** hole to set the ring's rotation phase. The same ring model from D3 step 5 derives the remaining 19 positions immediately. The user then nudges individually as needed and picks the target hole. This mirrors the low-click principle behind Salk's brief ("twelve hundred clicks... think hard about this step") even in the worst case — full manual entry is 3 primary interactions, not 20+.

### D5 — Motion-onset trial-start detection

Per-frame difference is computed inside the platform mask only (from D3's fitted geometry when available, else the rough Otsu mask), as sum of thresholded absolute differences between consecutive decoded frames, using the already-decoded Worker frame set (no extra decode pass — the same pipeline that will later build MS-3's background model can share this scan). A noise floor is estimated from an early window (the frozen segment is expected to dominate the clip's opening); trial start is the first index where the difference **exceeds the floor by a configurable factor and stays elevated for a minimum consecutive-frame duration** (rejects single-frame compression-interval spikes at the 15-frame keyframe boundary, per constitution finding #8, and rejects one-frame decode glitches). This is a motion-*onset* detector, not a blob-*presence* detector, which is exactly why it does not mistake `test51`'s static start cylinder (present but motionless from frame 1) for a trial already under way — it isn't a threshold on "is there something dark," it's a threshold on "did something change." Both a hand placing the mouse (`test50`/`test53`, whose pre-trial frames show an empty platform) and a cylinder being lifted (`test51`) register as legitimate motion at trial start; MS-2 does not need to tell those two cases apart, only find *when* motion begins. Distinguishing hand/cylinder objects from the animal itself is MS-3's tracking-gate concern, not MS-2's.

Trial **end** defaults to the last entry in the `timestampIndex` (the full recording) — MS-2 does not attempt escape detection (MS-5's job). The **cutoff** is a separate, user-editable duration from confirmed start (default matches common protocol practice, e.g. 180 s, editable per trial) used only to shade the timeline; it does not truncate stored data.

### D6 — Trial window is proposal-then-confirmation, not silent-accept

The auto-detected start is stored separately from the confirmed start (`proposedStartTimeUs` vs. `startTimeUs`) until the user takes an explicit confirm or edit action. The UI defaults to showing the proposal pre-filled and lets a single "Looks right" action confirm it, but the stored record always distinguishes "this is what the algorithm proposed" from "this is what the user accepted," and `source` (`'auto' | 'manual'`) plus a `confirmedAt` timestamp record which happened. This is the same honesty pattern the constitution requires for geometry provenance, applied to timing.

### D7 — Template reuse re-detects, it does not blindly copy pixels

Applying a template to a destination trial:
1. Copies the *shape* of the source geometry — the ring's relative hole angles, the target hole's angular position, the platform diameter (cm) the user already entered, and (if present) the `pxPerCm` scale as a **starting value**, not the absolute pixel `center`/`radius`.
2. Re-runs D3's automatic detection on the destination trial's own reference frame independently. If it succeeds confidently, its own fit is used for center/radius/rotation — the template's contribution is limited to pre-filling target-hole identity and diameter (which are properties of the physical rig and protocol, plausibly constant within one session, not properties of the camera framing).
3. If the destination's own detection is weak or fails, the template's ring shape becomes the primary proposal: it is rendered as a draggable/scalable overlay (one drag to translate, one handle to scale, one handle to rotate) that the user aligns to the visible platform, instead of placing 20 points individually.
4. Either way, a **discrepancy check** compares the destination's own rough platform measurement (Otsu mask centroid/radius from D3 step 2, which requires no ring fit to compute cheaply) against the template source's. If they differ beyond a configurable tolerance, the UI surfaces an explicit warning ("this trial's rig looks different from the template's source — review the overlay carefully") rather than silently trusting the template. This is exactly the guard needed for `test51` vs. `test50`/`test53`: applying either sample rig's template to the other must warn, not silently misplace 20 holes.
5. Result is stored with `source: 'template'` and `templateSourceTrialId` set until the user confirms/edits, at which point `confirmedAt` is set (the `source` value is retained as provenance of *how* it was produced, separate from *whether* it's confirmed — see Data contracts).

### D8 — 20-hole assay contract (approved)

NeuroTrack AI targets the standard 20-hole Barnes maze required by the Salk task. Ring-fit math uses a fixed `HOLE_COUNT = 20` constant in code — this is the assay contract, not a user-facing setting and not filename-specific logic. Generalization is achieved via threshold-relative pixel measurements, not by making hole count adjustable.

### D9 — Template target-hole requires explicit confirmation (approved)

When applying a template, the source trial's target-hole identity may pre-fill the destination UI as a **proposal** (`proposedTargetHoleId`). Geometry confirmation requires an explicit user action to confirm the target hole for this trial (`targetHoleConfirmedAt` set). Until confirmed, downstream steps treat target-hole selection as incomplete even if other geometry fields are confirmed.

---

## Plan

Sequenced for incremental, testable delivery; each step keeps the app buildable and MS-1's validation green.

1. **Data model.** Extend `Geometry`, `TrialWindow`, and add `Hole` per [Data contracts](#data-contracts). Write a `migrateTrialRecord` upgrade applied at hydrate time so MS-1-only persisted records get sane defaults for every new field (no Dexie schema version bump needed — fields are additive and optional at the object level).
2. **Timeline/scrubbing primitives.** A `useVideoTimeline` hook wrapping `<video>` + rVFC, mapping `mediaTime` to the nearest `timestampIndex` entry; a shared `videoToDisplay` transform (D2); a time ruler component with drag-to-scrub.
3. **Worker frame cache for stepping.** Extend the existing ingest Worker (or a sibling Worker sharing `mp4-utils.ts`) with a "decode to bitmap cache" mode and a request/response protocol for "give me frame at `timeUs`", with an LRU eviction policy analogous to MS-1's blob cache.
4. **Review player UI.** Play/pause, step ±1 frame, step ±1 second, scrub, timestamp readout, keyboard shortcuts, a discoverable shortcuts legend.
5. **Overlay rendering surface.** Canvas layer draggable/clickable for later steps (hole nudge, template alignment, trial-window handles), built once and reused by calibration and trial-window UI rather than three separate canvases.
6. **Calibration algorithm.** Reference-frame sampling, Otsu mask, hole-candidate detection, ring fit, platform-edge radius scan — as pure, unit-testable functions operating on pixel buffers, called from a Worker (reuses decode infrastructure; avoids blocking the main thread on a ~640×480 image scan, which is cheap, but keeps the pattern consistent with MS-1/MS-3).
7. **Calibration UI.** Auto-detect action, confirm/nudge/target/diameter controls, "Technical details" disclosure for fit residuals/candidate counts, manual fallback flow (D4).
8. **Template reuse.** "Apply template from…" picker (lists other calibrated trials in the session), alignment overlay controls, discrepancy warning (D7).
9. **Trial-window algorithm.** Motion-onset scan as a pure function over decoded frames (D5), reusing step 3's frame access.
10. **Trial-window UI.** Proposal display, accept/edit controls, cutoff input, shaded pre-trial/post-cutoff timeline regions (D6).
11. **Status/progress indication.** Per-trial stepper/badge reflecting geometry-confirmed / window-confirmed state (RE5).
12. **Accessibility pass.** Keyboard reachability for every new control, focus visibility, non-color-only state, 200% zoom check — same checklist MS-1 used.
13. **Unit tests.** Timing→display mapping, ring fit (synthetic ground-truth rings with noise), motion-onset detector (synthetic step functions plus the compression-artifact case), migration function.
14. **`scripts/validate-ms2.mjs`** (Playwright), extending the MS-1 validation pattern, covering the criteria below.

---

## Data contracts

Additive to the constitution's contracts and MS-1's `src/domain/types.ts`; nothing existing is removed or renamed.

```ts
export interface Hole {
  id: number;
  x: number;
  y: number;
  /** How this position was produced. */
  source: 'detected' | 'model' | 'manual';
  /** Fit confidence for 'detected' holes; null otherwise. Technical-details only. */
  confidence: number | null;
}

export interface Geometry {
  platformCenter: { x: number; y: number } | null;
  platformRadiusPx: number | null;      // platform edge, not hole-ring radius
  holes: Hole[];                         // was Array<{id,x,y}> in MS-1 — narrowed to Hole
  targetHoleId: number | null;
  proposedTargetHoleId: number | null;   // NEW — template may propose; not experimental truth until confirmed
  targetHoleConfirmedAt: string | null;  // NEW — explicit user confirmation required
  pxPerCm: number | null;
  diameterCm: number | null;             // NEW — user-entered real-world platform diameter
  ringRotationDeg: number | null;        // NEW — phase offset of the 20-point comb
  source: 'auto' | 'manual' | 'template' | null;
  templateSourceTrialId: string | null;  // NEW — set when source === 'template'
  confirmedAt: string | null;            // NEW — null while still an unconfirmed proposal
  calibrationReviewAcknowledgedAt: string | null; // NEW — explicit human review for low-confidence auto
  detection: {                           // NEW — Technical-details-only, never scientific truth
    holeCandidateCount: number | null;
    ringFitResidualPx: number | null;
    platformEdgeSampleCount: number | null;
  } | null;
}

export interface TrialWindow {
  startTimeUs: number | null;
  endTimeUs: number | null;
  cutoffSeconds: number | null;
  source: 'auto' | 'manual';
  proposedStartTimeUs: number | null;    // NEW — algorithm's suggestion, kept even after edits
  proposedEndTimeUs: number | null;      // NEW
  confirmedAt: string | null;            // NEW — null while still an unconfirmed proposal
  motionOnsetConfidence: number | null;  // NEW — Technical-details-only
}
```

Notes:
- `Geometry.holes`'s element type narrows from MS-1's untyped inline shape to `Hole`; this is additive in practice (MS-1 never populated `holes`, since geometry was a placeholder — see `createEmptyGeometry()` in `src/domain/trialFactory.ts`), so no live data is reshaped.
- `origin`/`observed` orthogonality (constitution's rule for `Observation`, MS-3+) is mirrored here for geometry: `source` says *how* a value was produced, `confirmedAt` says *whether a human has signed off on it* — the same distinction the constitution requires downstream.
- A trial-level status derived from these fields (not stored) drives RE5: `needs_review` (no confirmed geometry) → `geometry_confirmed` (geometry `confirmedAt` set) → `window_confirmed` (both `confirmedAt`s set) → ready for MS-3.

---

## Validation

Extends `scripts/validate-ms1.mjs`'s pattern (Playwright against the three local sample clips) with `scripts/validate-ms2.mjs`. Numbered for direct pass/fail reporting.

| # | Criterion | Pass condition |
|---|---|---|
| V1 | Player loads all three trials | Review view opens for `test50`, `test51`, `test53` without per-file branches. |
| V2 | Playback/scrub sync | During playback and after a scrub, the overlay's drawn geometry position matches the displayed frame within 1 px at native resolution. |
| V3 | Frame stepping correctness | Stepping forward N times then backward N times returns to the exact starting `timeUs`; stepping across a keyframe boundary (every 15th frame) does not skip or repeat a frame. |
| V4 | Timestamps are real | Every displayed/stored time traces to a `timestampIndex` entry; `test51` step deltas equal 1001/15000 s, never 1/15 s. |
| V5 | Calibration finds 20 holes | All three clips: 20 modeled hole positions produced; report the `detected` vs. `model` split per clip (target: 20/20 `detected` on all three, matching the constitution's prior finding, but the test asserts the honest split, not a hard "20 detected"). |
| V6 | `test51` generalization | Calibration on `test51` does not use any `test51`-specific code path; its differing center/radius/brightness (per constitution) is handled by the same detection function as the other two. |
| V7 | Manual correction | A hole can be nudged and the corrected position/`source: 'manual'` persists across reload. |
| V8 | Target + scale persistence | Target hole and `diameterCm`/`pxPerCm` survive reload. |
| V9 | Template reduces effort | Applying `test50`'s (or `test53`'s) confirmed geometry as a template to the other reduces the number of user actions needed to reach a confirmed geometry, versus calibrating that trial from scratch. |
| V10 | Template cross-rig honesty | Applying `test50`'s or `test53`'s template to `test51` (or vice versa) triggers the discrepancy warning (D7) rather than silently accepting a misaligned fit. |
| V11 | Trial-start proposal accuracy | Proposed start lands within a defined tolerance (e.g., ±0.5 s) of ~5.0 s on all three clips. |
| V12 | `test51` cylinder rejection | `test51`'s proposed start is not at/near `t=0` (i.e., the static cylinder alone does not trigger a "trial already started" result). |
| V13 | Manual window edits persist | An edited start/end/cutoff survives reload and is distinguishable from the original proposal. |
| V14 | Accessibility intact | Keyboard reachability, visible focus, non-color-only state, and 200% zoom usability hold for every new control (player, calibration, template, trial window). |
| V15 | No filename branching | Static check (grep/lint rule or code review) confirms no `test50`/`test51`/`test53` string literals gate behavior in the shipped calibration/trial-window code (fixtures/tests are exempt). |
| V16 | Calibration quality | Per-clip confidence tiers and slot residuals within defensible bounds (`test51` low-confidence, `test50`/`test53` high-confidence). |
| V17 | test53 trial start populated | After detect, `test53` start input is populated (~4.5–5.5 s). |
| V18 | Trial start never silent | Detect surfaces proposed start or visible failure banner on all three clips. |
| V19 | Per-trial isolation | Sequential calibrate + switch + reload preserves distinct per-trial calibration metrics. |
| V20 | Low-confidence review ack | `test51` low-confidence auto calibration requires explicit “I reviewed this calibration” acknowledgment before confirm; hole edits are **not** required. |

---

## Low-confidence calibration confirmation (approved)

When automatic calibration returns `confidence: 'low'` or `'failed'`:

1. Show the low-confidence warning with fit residuals in technical details.
2. Require the scientist to visually review the 20-hole overlay.
3. Allow optional hole nudges — **not** required for confirmation.
4. Require an explicit acknowledgment control: **“I reviewed this calibration on the video overlay.”**
5. Store acknowledgment in `Geometry.calibrationReviewAcknowledgedAt` (cleared on re-detect, manual calibration, or template apply).
6. Preserve per-hole provenance: untouched holes remain `detected`/`model`; only nudged holes become `manual`.

High-confidence auto calibrations may confirm without the acknowledgment step.

---

## Template reuse (verified)

- **Same rig (`test50` → `test53`):** destination re-detects independently; template proposes target hole and diameter. Rough-platform discrepancy check passes (no warning). V9 validates 20 holes after apply.
- **Cross rig (`test50` → `test51`):** rough-platform comparison triggers visible warning (V10). Destination geometry comes from destination detection when confident; template does not blindly copy pixel coordinates when registration path is available.

---

## Frame-accurate navigation (verified)

- Stepping uses Worker-decoded frames indexed by `timestampIndex` frame indices — not assumed integer FPS.
- `test51` step deltas trace to 15000/1001 container timing (V4).
- V3 validates ±1 frame round-trip, timestamp sync, and frame reset after trial switch.
- Async load generation guards prevent stale frame bitmaps during rapid stepping.

---

## Report

### Proposed MS-2 UI workflow

From the trial list (unchanged from MS-1), selecting a ready trial opens a **Review & Calibrate** view with one persistent player at the top and a sequence of panels below it that all draw on the same overlay canvas: (1) review the video with play/scrub/step and keyboard shortcuts; (2) run automatic maze detection (one button) or apply a template from another trial in the session, then confirm/nudge/pick target/enter diameter; (3) review/edit the proposed trial start and end, and set the protocol cutoff, with pre-trial and post-cutoff regions shaded on the timeline. A per-trial status indicator reflects progress through these steps, so a session of several trials shows at a glance which ones still need review. Technical/debug numbers (fit residuals, candidate counts, motion-onset confidence) sit behind a "Technical details" disclosure matching MS-1's pattern, never in the primary view.

### Geometry/calibration algorithm

Median pre-trial reference frame → Otsu platform mask (rough seed only) → dark-blob hole candidates in a radial band around the rough center → least-squares circle fit to candidates (authoritative center/radius for the ring) → best-fit rotation phase against a uniform 20-point comb (18° spacing) → per-hole `detected`/`model` provenance → platform-edge radius via radial bright→dark scan from the authoritative center (for `pxPerCm`, kept distinct from the ring radius). Fails visibly to a 3-click manual fallback (center, radius, one hole to set phase) rather than guessing.

### Template-reuse strategy

Copy the *shape* (relative hole angles, target angle, diameter/scale as a starting value), not absolute pixel coordinates. Re-run independent detection on the destination first; only fall back to an aligned template overlay (drag/scale/rotate) when the destination's own detection is weak. A cheap rough-mask discrepancy check between source and destination surfaces a visible warning when the rigs look different (the `test51`-vs-others case) instead of silently trusting the template.

### Trial-window algorithm

Frame-difference motion detector confined to the platform mask, with a noise floor learned from the clip's own opening frames and a minimum-sustained-duration rule that rejects the 15-frame compression-interval spikes. Detects *onset of change*, not *presence of an object* — which is what correctly ignores `test51`'s static start cylinder. End defaults to full recording length; cutoff is a separate, editable, non-truncating duration from confirmed start.

### Data model changes

Additive fields on `Geometry` (`diameterCm`, `ringRotationDeg`, `templateSourceTrialId`, `confirmedAt`, `detection{}`) and `TrialWindow` (`proposedStartTimeUs`, `proposedEndTimeUs`, `confirmedAt`, `motionOnsetConfidence`), plus a new `Hole` type carrying per-hole `source`/`confidence`. All optional/nullable; a migration function backfills MS-1 records at hydrate time. No renames, no removals.

### Validation plan

Fifteen numbered criteria (V1–V15 above) exercised by an extended Playwright script against all three local sample clips, covering player sync/stepping correctness, calibration on all three rigs including `test51`'s divergent one, manual correction and persistence, template reuse (both same-rig efficiency and cross-rig honesty), trial-window accuracy and cylinder rejection, accessibility, and a static no-filename-branching check.

### <a id="risk-summary"></a>Three highest-risk implementation details

1. **Frame-accurate stepping via a hybrid `<video>`+Worker-decode player.** Phase 0 validated continuous playback timestamps, not repeated discrete single-frame seeks. Building a reliable, responsive stepper that never silently shows the wrong frame is new engineering surface, not a re-use of an already-validated path.
2. **Overlay/coordinate-transform correctness across zoom, DPI, and resize.** A quietly-wrong scale factor produces a plausible-looking but incorrect overlay — exactly the kind of error that is hard to notice by eye and easy to introduce with per-component ad hoc math; this spec centralizes the transform for that reason, but it remains the most failure-prone class of bug in this milestone.
3. **Calibration and template-reuse generalization beyond the three validated clips.** The algorithm is designed to be threshold-relative rather than filename-specific, but it has only been validated against three rigs, two of which share a setup. Genuinely different lighting, hole counts, or platform contrast in videos not in hand remain unproven; the manual fallback and discrepancy warnings exist specifically to make failure visible rather than eliminate the possibility of it.

### Constitution assumption — resolved

The 20-hole ring is the Salk task's assay contract. Fixed `HOLE_COUNT = 20` in code; not user-configurable. Generalization applies to lighting, camera position, and timing — not to non-standard hole counts.

---

*Implementation follows this approved spec on branch `ms-2-review-player-maze-calibration-trial-window`.*

## Completion

**Status: Pending manual visual review** (automated validation green; not merged to `main`)

| Check | Result | Notes |
|---|---|---|
| V1–V20 | PASS | `npm run validate:ms2` against test50, test51, test53 |
| Unit tests | PASS | ringFit, refineHoles, motionOnset, templateService, migration, videoTransform |
| MS-1 regression | PASS | `npm run validate:ms1` |
| Offline calibration | PASS | `npm run validate:calibration` |

### Known remaining MS-2 limitations

- Calibration validated on three sample rigs only; genuinely different lighting or non-20-hole mazes may still fail visibly (manual fallback + low-confidence acknowledgment exist for this).
- Frame stepping depends on WebCodecs worker decode; very large videos may need LRU tuning not exercised here.
- Template reuse uses rough-platform discrepancy check, not full feature-based registration — sufficient for sample cross-rig warning, not a general CV registration system.
- Motion-onset confidence is heuristic (~5 s expected region); unusual protocols may need manual trial-start edit.
- `platformEdgeSampleCount` retained internally but removed from scientist-facing technical details (value was not meaningful in current pipeline).

### Manual validation still required

- Visual overlay alignment on all three clips after final fixes.
- Low-confidence acknowledgment workflow on `test51` without nudging holes.
- Template apply `test50` → `test53` overlay sanity check.
- Cross-rig warning readability on `test50` → `test51`.

*Do not merge to `main` until manual review sign-off.*
