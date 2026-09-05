# NeuroTrack AI — Project Constitution

Authoritative product and engineering charter for the Barnes Maze Analysis Pipeline (Salk Task 1). Read alongside `reference/salk-assignment.md`, `reference/task-01-barnes-maze.md`, and `reference/sample-data.md`.

This document guides implementation. It is not a feature specification — each roadmap phase gets its own spec when work starts.

---

## Mission

### Who it is for

Behavioral neuroscience students and core-facility staff who run Barnes maze cohorts (~60 videos per cohort) and need publication-ready measurements without becoming software operators.

Today they score trials with a stopwatch and a clicker and retype results into Excel. It takes days, raters disagree, and definitions drift between people. They work on a lab laptop, without admin rights, and may use the tool only a few times a year.

### The scientific problem

The Barnes maze measures hippocampus-dependent spatial learning. A mouse searches a brightly lit circular platform ringed with 20 identical holes; one leads to a dark escape box. Papers report latencies, error counts, path metrics, quadrant occupancy, and search strategy. Manual scoring is slow, inconsistent, and sensitive to definitions that are rarely written down — above all "what counts as investigating a hole."

NeuroTrack AI automates trajectory-based scoring while keeping every definition **explicit, visible, and adjustable**, so a facility can defend its numbers to a reviewer.

### The complete user outcome

Open a URL (no install) → load trial videos → confirm auto-detected maze geometry and real-world scale → confirm the trial window → track the animal with progress feedback → read a quality report → correct anything wrong by hand → review events and measures with their reasoning shown → download CSV/XLSX (per-trial summary + per-event detail + parameters) → save a reloadable analysis file so measures can be recomputed without re-tracking.

The bar for the demo: all three supplied clips (`test50`, `test51`, `test53`) analyzed end to end, with generated outputs committed to the repository.

### Core principles

| Principle | Meaning in practice |
|---|---|
| **Usability first** | No terminal, install, GPU, or admin rights for the user. Keyboard navigable, legible contrast, usable at 200% zoom, labeled controls. |
| **Scientific defensibility** | Every measure exposes its definition and thresholds. Strategy labels show their reasoning and can be overridden. |
| **Honest uncertainty** | Tracking failures are visibly identified. Gap filling and smoothing are allowed when scientifically justified but never silent: interpolated points stay distinguishable from directly tracked and from manually corrected points, and the parameters are visible. |
| **Never fabricate** | If the animal never escaped within the recording, the tool reports a censored value with a flag — not a number that looks measured. |
| **Human correction is mandatory** | Manual fixes propagate downstream. Provenance survives reload. Any result can be traced back to the frame it came from. |
| **Reproducibility** | Exports carry tool version and every parameter. The intermediate representation is documented and reloadable. |
| **Local-first, zero egress** | All computation happens in the user's browser. No video, trajectory, or animal record leaves the machine. This is both a privacy property (IACUC-adjacent data) and the reason no API key or running cost is required. |
| **Generalization over tuning** | Geometry, exposure, and timing are *detected per video*, never branched on filename. Measured properties of the sample clips are validation evidence and default operating ranges, not special cases in code. |
| **Timing fidelity** | Every reported time derives from the container's own presentation timestamps, never from an assumed or integer frame rate. |

---

## What the sample data actually shows

Measured independently from the three clips (median-background subtraction, hole-ring fits, interframe analysis). Recorded here because these facts drive design decisions and belong in the eventual "Known limitations" section. **They must not appear as per-filename logic.**

| Property | test50 | test51 | test53 |
|---|---|---|---|
| Frames / duration | 5,539 / 185.07 s | 741 / 49.38 s | 905 / 30.23 s |
| Frame rate (container) | 30/1 | **15000/1001 ≈ 14.985** | 30/1 |
| Platform centre, radius (px) | (329, 242), r≈204 | **(284, 244), r≈218** | (329, 242), r≈204 |
| Platform mean gray / Otsu | 126 / 73 | **145 / 92** | 125 / 73 |
| Holes auto-detected | 20 / 20 | 20 / 20 | 20 / 20 |
| Animal first visible | 5.01 s, mid-platform | 5.00 s, centre | 5.01 s, **near rim** |

Findings that change the design:

1. **A ~5 s frozen pre-trial segment opens every clip.** Interframe difference is ~0.00 until motion begins at exactly 5.0 s in all three. Measuring latency from video *t=0* would inflate every latency by ~5 s. **A trial window (start, end, cutoff) is a required, user-confirmable concept.**
2. **`test51` opens with an opaque start cylinder over the animal at platform centre** — a compact ~3,200 px dark object, roughly 4× the animal's area. A naive "largest dark blob" tracker follows the cylinder. Non-animal foreground objects (start cylinder, experimenter hand) must be rejected on size/shape, not assumed away.
3. **Escape is progressive, not a clean disappearance.** No clip shows the blob vanishing outright. Visible area decays as the animal descends (test53: ~606 → ~170 px over the final 2.6 s at the rim; test51: 654 → 350 px; test50 settles at ~550 px and stops moving). A binary present/absent rule would detect **no escape in any of the three clips** and report "never escaped" for all of them. Escape evidence must combine proximity to a hole, sustained area loss, loss of motion, and darkening of the hole region.
4. **All three clips end mid-entry, so total latency is right-censored in all three.** Censoring is normal in this assay (protocols use a cutoff, commonly 180 s; `test50`'s 185 s is consistent with one). Censored results must be flagged, never silently emitted as a latency equal to clip duration.
5. **A circular platform model is sufficient.** Hole-ring circle fits leave ≤2.1 px maximum residual (mean ≤1.0 px); best-fit ellipse axis ratios are 0.984–0.994. No homography or lens undistortion is needed for the MVP.
6. **Fit geometry from the hole ring, not the bright-region centroid.** The two differ by ~7 px because of the platform lighting gradient. Hole angular spacing averages exactly 18.0° (σ ≈ 0.6°), so a parametric ring (centre, radius, rotation, 20 positions) plus per-hole refinement is accurate and cheap in clicks.
7. **Intra-platform lighting is strongly uneven** — quadrant means differ by 17–21 gray levels. A single global threshold cannot work; a **per-pixel** background model is required, not optional.
8. **A 15-frame periodic compression artifact is present**, matching the keyframe interval noted in the data README. Interframe difference spikes at every keyframe. Smoothing, outlier rejection, and confidence scoring must not mistake this for animal motion.
9. **`test50` and `test53` share one rig; `test51` is a different setup** (≈45 px lateral offset, ≈6 % larger radius, markedly brighter). This is exactly the case the Salk brief cites as a known-limitation example, and it is what maze-template reuse must survive.
10. **The animal does not always start at the centre** (`test53` first appears near the rim). Search-strategy classifiers that assume a centre start must state that assumption and degrade honestly.
11. **Decoded frame counts did not always match container `nb_frames`** (e.g. 5,553 decoded vs 5,539 reported for `test50`). Frame index is therefore not a safe primary key: **key all data on presentation timestamps** and surface a warning when the decoded count disagrees with metadata.

Validated as feasible, so no longer open questions: per-pixel median-background subtraction detects the animal in essentially every in-trial frame across all three clips (median blob ≈ 600–750 px), and automatic 20-hole detection succeeded 20/20 on all three.

---

## Tech Stack

### Firm

| Layer | Choice | Why |
|---|---|---|
| **Delivery** | Static single-page app on **GitHub Pages** | Salk's stated ideal for Task 1: the user opens a URL. No server, no account, no install, nothing to maintain. |
| **App** | **Vite + React + TypeScript** | Typed domain models (trial, observation, event, provenance) are the main defence against silently wrong science. Vite emits a static bundle. |
| **Styling** | CSS Modules with design tokens | Small bundle; direct control over contrast and zoom behaviour. |
| **State** | **Zustand** | Session state without ceremony. |
| **Persistence** | **IndexedDB via Dexie** | Corrections and analyses survive refresh, which the brief calls out explicitly. |
| **Analysis bundle** | Versioned JSON (`.neurotrack.json`) | Documented, human-readable, reloadable; recompute measures without re-tracking. |
| **Compute** | **Web Workers** with typed arrays | Decode and CV off the main thread; UI and progress stay responsive. |
| **Background model** | Per-pixel median over sampled frames | Validated on all three clips; handles the strong intra-platform lighting gradient that defeats global thresholding. |
| **Maze detection** | Otsu platform mask → dark-blob hole candidates → least-squares ring fit | Validated 20/20 hole detection on all three clips. |
| **Export** | **SheetJS** for XLSX, hand-rolled CSV | Client-side, no server. |
| **Visualization** | **D3** (or plain SVG/Canvas where simpler) | Trajectory overlays, heat maps, hole-visit rasters, learning curves; needed for grayscale-safe palettes and export resolution. |
| **Testing** | **Vitest** for logic, **Playwright** for a thin end-to-end path | Timing, measures, censoring, and provenance are pure functions and must be unit-tested. |
| **CI** | **GitHub Actions** | Lint, test, build, deploy. Dependencies pinned via lockfile. |
| **License** | Permissive (MIT) | Salk asks for one explicitly. |

### Video decode — corrected primary path

**`WebCodecs VideoDecoder` + an MP4 demuxer (`mp4box.js`), inside a Worker, is the primary decode path.** `<video>` + Canvas is *not* adequate as the analysis path:

- Per-frame seek-and-draw over 5,539 frames is far too slow, and capturing during playback caps throughput at real time (≥185 s for `test50`) while risking dropped frames.
- **Corrected by Phase 0 (D7):** `requestVideoFrameCallback` *does* expose a genuine per-frame presentation timestamp (`mediaTime`) and a `presentedFrames` skip-counter — timestamp availability was never the real limitation. What the Phase 0 spike measured instead: it is main-thread-only (no Worker — `HTMLVideoElement` cannot exist off-thread); it delivered fewer callbacks than the container/decoder frame count on every clip without always signaling a gap (`test50`: 5,338 callbacks vs. 5,539 frames, zero `presentedFrames` gaps logged); and wall-clock throughput tracks playback speed rather than beating it (raising `playbackRate` to 4× produced no measured speedup in testing). See `spike/phase-0-decode-timing/results/findings.md`.

WebCodecs gives frame timestamps in microseconds **from the container timebase**, decodes much faster than real time (190–430× on the three sample clips, measured), and runs in a Worker. Support is Chrome/Edge 94+, Firefox 130+ desktop, and Safari 16.4+ for the video interfaces we use (`VideoDecoder`, `EncodedVideoChunk`, `VideoFrame`); it is not Baseline only because Firefox for Android lacks it, which does not affect a desktop analysis tool.

Required: feature-detect with `VideoDecoder.isConfigSupported()` and fall back to `<video>` + `requestVideoFrameCallback` with an explicit, visible notice that analysis will be slower. `<video>` + `requestVideoFrameCallback` remains the human review and scrubbing surface either way — that role never depended on frame-complete delivery or beating real time, only on `mediaTime` being a real timestamp, which it is.

### Spike questions — disposition after Phase 0 and the Monday-night replan

| Question | Status |
|---|---|
| **Decode throughput and timestamp exactness** | **Resolved by Phase 0.** All three clips decode with zero decoder errors at 190–430× real-time; `test51` spacing confirmed as exactly 1001/15000 s (median unique-`cts` interval), not 15 fps; frame counts agree across `ffprobe`/`mp4box`/decoder on all three clips. See `spike/phase-0-decode-timing/results/findings.md`. |
| **Escape vs tracking loss** | **Not spiked separately — no schedule room.** Implemented directly, at full strength, in MS-5 (no simplified first pass; this is the scientific core of the submission). |
| **Nose vs body from geometry alone** | **Deferred.** MS-3 ships a body-centroid proxy for the nose point, documented as a known limitation. True geometric nose estimation is optional hardening, cut first if time runs short. |
| **Video persistence policy** | **Decided pragmatically for MVP.** MS-1 ships Dexie autosave for session/trial metadata; video re-identification may simply re-prompt for the file on reload rather than a bounded blob cache. Blob-cache refinement is optional hardening. |

### Deliberately not chosen

- **Any backend** — unnecessary, and it would add auth, hosting, and data-egress problems the user must not inherit.
- **Python / notebook pipeline** — precisely what the facility said it cannot run.
- **Hosted vision API** — would send animal research video off-machine for no benefit the local path cannot deliver.
- **GPU or in-browser ML model** — held in reserve if the nose-estimation spike fails; not needed for detection, which is already validated.
- **Desktop app (Electron/Tauri)** — breaks "open it in a browser."
- **Ellipse or homography maze model** — measured residuals show a circle is sufficient.

---

## Roadmap

**Replanned September 5, 2026**, after Phase 0 completed, against a hard deadline: submission-ready by **Monday night** with **no Tuesday-morning buffer**. The original 18-phase roadmap (Phase 0–17) is compressed into six vertical-slice milestones plus a required-submission-closure list. This changes sequencing and grouping only — every original requirement is preserved; nothing below is new scope. Where a milestone is explicitly marked "basic," that is a deliberate, named simplification for the first working pass, not a silent scope cut. See the phase-mapping table at the end of this section for where every original phase landed.

The target user journey, unchanged: load video → review video → define/calibrate maze → define trial window → track mouse → inspect quality → manually correct → detect events → compute measures → visualize → export → save/reload.

### Phase 0 — Decode and timing spike — ✅ Done
Worker-based WebCodecs decode of all three clips; timestamp verification against the container timebase; throughput measurement; fallback path proven. See `spike/phase-0-decode-timing/results/findings.md` and the corrected D7 finding above. Throwaway harness code; the decision (WebCodecs + mp4box.js primary, `<video>`/rVFC as review-only fallback) is binding.

### MS-1 — Foundation, Ingest & Persistence
*Absorbs Phase 1, Phase 2, Phase 3 (basic).*
Vite + React + TS scaffold, MIT license, CI running lint/test/build and deploying to Pages. Accessibility baseline (focus order, labels, contrast tokens) — floor, not deferred. Drag-and-drop plus folder selection for multiple files, reusing the Phase 0 WebCodecs/mp4box worker unchanged. Per-video metadata and a timestamp index built from decoded presentation times. Dexie schema for trials, parameters, and progress, with autosave.
**Basic now, optional hardening later:** video re-identification on reload may simply re-prompt for the file rather than a bounded blob cache; session/trial metadata persists in full regardless.
**Validate:** cold clone builds from README alone and deploys; all three clips load and decode without hardcoding; `test51` resolves to 15000/1001, not 15; a mid-session refresh loses nothing.

### MS-2 — Review Player, Maze Calibration & Trial Window (basic)
*Absorbs Phase 4, Phase 5 (basic), Phase 7 (basic).*
Frame-accurate scrubbing, frame stepping, keyboard shortcuts, and a Canvas overlay locked to the displayed frame. Maze calibration via a small number of clicks (platform center, radius, one hole for rotation reference) generating the 20-hole parametric ring, with per-hole nudging and target-hole selection; platform diameter in cm drives a pixel→cm scale. Trial window set manually (start, end, configurable cutoff); pre-trial frames excluded from measures and clearly marked.
**Basic now, optional hardening later:** calibration is manual/semi-manual, not automatic platform/hole detection; trial-window start/end is user-set, not auto-proposed from motion onset; no cross-trial template reuse yet.
**Validate:** overlay matches the displayed frame on all three clips, including across keyframe boundaries; a full calibration and trial window can be completed for any of the three clips through the UI alone; distances report in cm.

### MS-3 — Tracking v1 & Raw Quality Signal
*Absorbs Phase 8, Phase 9 (raw signal only), Phase 10 (basic).*
Worker pipeline: per-pixel median background, per-pixel differencing, morphology, animal blob selection with size/shape gating against non-animal objects (rejecting the `test51` start cylinder specifically), body centroid, per-frame observation status (`tracked`/`lost`) with confidence, and blob area carried forward as future escape evidence. Progress indicator. Basic per-video tracked/lost/absent fraction reporting.
**Basic now, optional hardening later:** the nose point is the body-centroid proxy, not a true geometric nose estimate; no cancel/resume; the animal-absent cause is not yet split into `absent_in_hole` / `absent_pre_trial` / `lost` — that semantic split happens in MS-5, where the evidence needed to make it is actually consumed.
**Validate:** trajectories produced on all three clips; the start cylinder is never tracked as the animal; frames without an animal are marked, not guessed; a progress indicator moves during the run.

### MS-4 — Manual Correction & Basic Cleaning
*Absorbs Phase 11 (basic), Phase 12 (full).*
Scrub to a frame, fix body position, add or remove events; downstream results recompute; corrections persist and are labeled as human-touched, surviving reload. Bounded-gap linear interpolation for small tracking gaps, origin-marked and visually distinct from tracked and manual points; cleaning parameters visible (read-only for now).
**Basic now, optional hardening later:** no live-preview or user-adjustable smoothing/outlier-rejection UI yet — parameters are visible but fixed.
**Not simplified:** manual correction itself is full-strength — non-negotiable per Salk's brief.
**Validate:** a correction survives reload, changes the affected measure, and is visually distinguishable from automatic output; an interpolated span is visually distinct from tracked and manual points.

### MS-5 — Event Detection & Behavioral Measures
*Absorbs Phase 9 (absence-cause finalization), Phase 13 (full), Phase 14 (full).*
Hole investigations from nose/body proximity, dwell, and approach speed, all thresholds exposed with immediate visible consequence. Escape detection from combined progressive-area, proximity, motion, and hole-darkening evidence, with each event showing the evidence behind it. Explicit censoring when no escape occurs before the cutoff or the recording ends — never a silent "never escaped" with a fabricated latency. Primary and total latency, primary and total errors, path length, speed, time in the target quadrant, and search-strategy classification (spatial / serial / random) with reasoning shown and override allowed. Censored and assumption-violating cases (e.g. a non-centre start) flagged, not quietly scored.
**Not simplified:** this is the scientific core of the submission, implemented at full strength with no separate first pass. The escape-vs-tracking-loss disambiguation — flagged as unresolved after Phase 0 — is designed and built for real here; there is no remaining schedule room for a dedicated spike.
**Validate:** the end-of-clip descent is detected as escape or reported censored on all three clips, never a silent "never escaped"; mid-platform tracker loss is never labeled an escape; changing a threshold visibly changes the event count; measures recompute from corrected trajectories with every time value from container timestamps; overrides persist.

### MS-6 — Visualization & Export/Bundle
*Absorbs Phase 15 (core), Phase 16 (full).*
Trajectory overlay and path plot at minimum (occupancy heat map, hole-visit raster, and cross-trial learning curve are optional hardening, not required for this milestone). CSV and XLSX with a per-trial summary, per-event detail, and a parameters/version sheet. Save and load the `.neurotrack.json` bundle; recompute measures from a bundle without re-tracking.
**Not simplified:** export/bundle completeness is required for the demo and cannot be trimmed.
**Validate:** figures render for all three clips; CSV/XLSX open cleanly in Excel with a parameters sheet; a saved bundle reloads and reproduces the same measures without re-tracking.

**MS-1 through MS-6 are the complete vertical slice and must be working, on all three clips, by Monday afternoon/evening.**

---

### Required submission closure — mandatory, due Monday night, no Tuesday buffer

Not optional, not hardening. Salk's explicit submission requirements; must ship regardless of what else slips:

- Live deployment (GitHub Pages) reachable by URL.
- `README.md` with the live URL and demo video at the top, cold-clone setup instructions, data-handling and cost paragraphs, and a "Known limitations" section separating defects from deliberately excluded scope — including anything cut from Optional hardening below, named explicitly, never silently missing.
- `AI_NOTES.md` covering tools/models used and specific moments of disagreement or rejected agent output, kept current.
- "Load example" seed state reaching real computed output within about sixty seconds, for all three clips.
- Generated outputs (per-trial summary, per-event detail, `.neurotrack.json` bundle) for `test50`, `test51`, and `test53` committed to the repo; sample videos linked, not committed.
- A 2–3 minute demo video showing all three clips analyzed end to end, including a manual correction, recorded without editing out slow or awkward parts.
- A basic accessibility validation pass — keyboard-only reachability, contrast, 200% zoom — per cross-cutting requirement #6 in the Salk brief; depth can be minimal under time pressure, but it is not skippable.
- Agent configuration (`.cursor/`) committed, not gitignored.

### Optional hardening — cut first, in this order, if the schedule slips

Genuine improvements, none required for a defensible submission, none to be started before required closure above is done:

1. Additional visualization polish — occupancy heat map, hole-visit raster, cross-trial learning curve, grayscale/export-resolution pass.
2. Enhanced cleaning UI — live-preview, user-adjustable smoothing/outlier-rejection parameters.
3. Nose/heading refinement — true geometric nose estimate and rim-occlusion handling, replacing the MS-3 body-centroid proxy.
4. Trial-window auto-propose from motion onset, replacing MS-2's manual entry.
5. Maze auto-detection (Otsu + hole-blob + ring fit), replacing MS-2's few-click manual calibration.
6. Maze template reuse across trials in a session (Phase 6).
7. Tracking cancel/resume; quality-report timeline strip with click-through; bounded blob-cache persistence refinement.

Anything cut from this list must be named in the README's Known Limitations section — cutting it silently is the one thing not allowed.

### Stretch — out of scope for this submission entirely

Cohort batch queue with progress; cross-session template library; inter-rater comparison; model-assisted labeling; MCP server for cohort summaries; SLEAP / DeepLabCut / ezTrack / AnyMaze interop. Per the Salk brief these are explicitly "if you have room"; there is no room this cycle.

### Phase → milestone mapping

| Old phase | New home |
|---|---|
| Phase 0 — Decode/timing spike | Done |
| Phase 1 — Foundation | MS-1 |
| Phase 2 — Video ingest/timestamp index | MS-1 |
| Phase 3 — Persistence | MS-1 (basic) + optional hardening (blob-cache refinement) |
| Phase 4 — Review player | MS-2 |
| Phase 5 — Maze geometry/calibration | MS-2 (basic) + optional hardening (auto-detect) |
| Phase 6 — Maze template reuse | Optional hardening |
| Phase 7 — Trial window | MS-2 (basic) + optional hardening (auto-propose) |
| Phase 8 — Tracking v1 | MS-3 |
| Phase 9 — Tracking v2 (nose/heading/absence semantics) | MS-3 (raw signal) + MS-5 (absence-cause finalization) + optional hardening (nose/heading refinement) |
| Phase 10 — Quality report | MS-3 (basic) + optional hardening (timeline strip) |
| Phase 11 — Trajectory cleaning | MS-4 (basic) + optional hardening (tunable UI) |
| Phase 12 — Manual correction | MS-4 |
| Phase 13 — Event detection | MS-5 |
| Phase 14 — Behavioral measures | MS-5 |
| Phase 15 — Visualizations | MS-6 (core) + optional hardening (remaining views) |
| Phase 16 — Export/bundle | MS-6 |
| Phase 17 — Demo state/submission artifacts | Required submission closure |

---

## Data model contracts

Stabilize early; everything downstream depends on them.

```
Trial          → video ref + fingerprint, metadata, trialWindow, geometry, track, events, measures
TrialWindow    → startTime, endTime, cutoffSeconds, source: 'auto' | 'manual'
Geometry       → platform circle, holes[], targetHoleId, pxPerCm, source
Observation    → timeUs, bodyXY?, noseXY?, confidence,
                 observed: 'tracked' | 'absent_in_hole' | 'absent_pre_trial' | 'lost',
                 origin:   'auto' | 'interpolated' | 'smoothed' | 'manual'
Event          → type: 'investigation' | 'escape_entry', holeId, startTime, endTime,
                 evidence{}, origin: 'auto' | 'manual'
Measures       → values + per-value { censored: bool, assumptions[], definitionId }
AnalysisParams → tracking, cleaning, event thresholds, quadrant convention, toolVersion
```

Two rules these encode:

- **`observed` and `origin` are orthogonal.** What the tracker saw is recorded separately from how the stored value was produced. This is what makes "failures are visible" and "interpolation is never silent" enforceable rather than aspirational.
- **Time is `timeUs` from the container.** Frame index is a convenience for display, never the key.

---

## Validation gates

Before any phase is called complete:

1. Its stated validation criteria are executed, not assumed.
2. Pure logic — timing, measures, censoring, provenance — has unit tests.
3. No silent interpolation, no hidden defaults, no fabricated values.
4. New UI is keyboard reachable and labeled.
5. Behaviour is detected or configured, never branched on filename.
6. The change is explainable in an interview.

---

## References

- `reference/salk-assignment.md` — assignment, cross-cutting requirements, evaluation criteria
- `reference/task-01-barnes-maze.md` — Task 1 functional specification
- `reference/sample-data.md` — sample video properties and known difficulties
- [talmolab/vibes](https://github.com/talmolab/vibes) — pattern inspiration; borrow, do not copy
