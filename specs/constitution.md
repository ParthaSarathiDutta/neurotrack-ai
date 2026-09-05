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
- It does not expose reliable per-frame presentation timestamps, which the timing-fidelity requirement depends on.

WebCodecs gives frame timestamps in microseconds **from the container timebase**, decodes much faster than real time, and runs in a Worker. Support is Chrome/Edge 94+, Firefox 130+ desktop, and Safari 16.4+ for the video interfaces we use (`VideoDecoder`, `EncodedVideoChunk`, `VideoFrame`); it is not Baseline only because Firefox for Android lacks it, which does not affect a desktop analysis tool.

Required: feature-detect with `VideoDecoder.isConfigSupported()` and fall back to `<video>` + `requestVideoFrameCallback` with an explicit, visible notice that analysis will be slower. `<video>` remains the human review and scrubbing surface either way.

### Open — resolve by spike before committing

| Question | Why it is risky | Spike outcome needed |
|---|---|---|
| **Decode throughput and timestamp exactness** | Foundation for every downstream measure; also decides whether the fallback path is usable at all | Decode all three clips in a Worker; confirm timestamps match the container timebase, count frames, and measure wall-clock time |
| **Escape vs tracking loss** | The core scientific disambiguation; getting it wrong inverts latency and error counts | Hand-label the end of each clip plus mid-platform losses; measure precision of the combined area/proximity/motion/darkening rule |
| **Nose vs body from geometry alone** | "Nose poke" definitions depend on it; contour geometry may be insufficient at the rim where the animal is occluded | Compare geometric nose estimates against hand-labeled rim investigations; decide whether an ML pose step is warranted |
| **Video persistence policy** | Re-selecting files after every reload would be a usability failure; caching whole cohorts could exhaust quota | Decide blob-cache size budget vs file-fingerprint re-prompt; verify `webkitdirectory` fallback where the File System Access API is absent |

### Deliberately not chosen

- **Any backend** — unnecessary, and it would add auth, hosting, and data-egress problems the user must not inherit.
- **Python / notebook pipeline** — precisely what the facility said it cannot run.
- **Hosted vision API** — would send animal research video off-machine for no benefit the local path cannot deliver.
- **GPU or in-browser ML model** — held in reserve if the nose-estimation spike fails; not needed for detection, which is already validated.
- **Desktop app (Electron/Tauri)** — breaks "open it in a browser."
- **Ellipse or homography maze model** — measured residuals show a circle is sufficient.

---

## Roadmap

Phases are ordered by dependency and sized so each can carry its own branch, spec, validation, review, and merge.

### Phase 0 — Decode and timing spike
Worker-based WebCodecs decode of all three clips; timestamp verification against the container timebase; throughput measurement; fallback path proven. Throwaway code is acceptable; the decision it produces is not.
**Validate:** exact timestamps recovered for a 15000/1001 fps clip; decoded frame counts reported and reconciled with metadata; measured throughput recorded.

### Phase 1 — Foundation
Vite + React + TS scaffold, workflow shell, accessibility baseline (focus order, labels, contrast tokens, 200% zoom), MIT license, CI running lint/test/build and deploying to Pages.
**Validate:** cold clone builds from README alone; deployed URL loads; keyboard reaches everything.

### Phase 2 — Video ingest and timestamp index
Drag-and-drop plus folder selection for multiple files. Per-video metadata and a **timestamp index** built from decoded presentation times. Editable trial labels.
**Validate:** all three clips load; `test51` resolves to 15000/1001, not 15; durations match the container; frame-count mismatches surface as warnings.

### Phase 3 — Persistence
Dexie schema for trials, parameters, and progress. Video handling per the spike decision (fingerprint + re-prompt, with bounded blob caching).
**Validate:** reload mid-session and lose nothing; a re-selected file is recognised as the same video.

### Phase 4 — Review player
Frame-accurate scrubbing, frame stepping, keyboard shortcuts, and a Canvas overlay locked to the displayed frame.
**Validate:** the overlay matches the displayed frame on all three clips, including across keyframe boundaries.

### Phase 5 — Maze geometry and calibration
Automatic platform detection and 20-hole ring fitting, with per-hole nudging, rotation, and target-hole selection. Platform diameter in cm drives a pixel→cm scale.
**Validate:** 20/20 holes on all three clips; correct on the off-centre, brighter `test51`; distances report in cm.

### Phase 6 — Maze template reuse
Save the geometry from one trial and apply it to others with alignment and per-trial override.
**Validate:** the second video of a session takes materially fewer clicks than the first (Salk's stated "good" criterion), including across the `test50`/`test53` shared rig.

### Phase 7 — Trial window
Cheap pre-scan proposes trial start (motion onset, non-animal object removal) and end; user confirms or edits; protocol cutoff is configurable. Pre-trial frames are excluded from measures and clearly marked.
**Validate:** ~5.0 s starts proposed on all three clips; the `test51` start cylinder is not mistaken for the animal; latencies are measured from trial start.

### Phase 8 — Tracking v1
Worker pipeline: per-pixel median background, per-pixel differencing, morphology, animal blob selection with size/shape gating against non-animal objects, body centroid, per-frame observation status and confidence. Progress, cancel, resume.
**Validate:** trajectories on all three clips; the start cylinder rejected; frames without an animal marked rather than guessed.

### Phase 9 — Tracking v2: nose, heading, and absence semantics
Nose estimate from blob geometry and heading; rim-occlusion handling; keyframe-artifact tolerance; and the distinction between **animal absent (inside a hole)**, **animal absent (pre-trial)**, and **tracker lost**.
**Validate:** nose and body diverge during rim investigations; the three absence causes are separated on hand-checked segments.

### Phase 10 — Tracking quality report
Per-video fractions tracked / lost / absent / interpolated, plus a timeline strip showing where failures cluster, with click-through to the frame.
**Validate:** a user can decide whether to trust a video before building a figure on it.

### Phase 11 — Trajectory cleaning
Gap filling, smoothing, and outlier rejection — every parameter visible, defaults conservative, effects previewed live, and each point carrying its production method.
**Validate:** interpolated spans are visually distinct from tracked and manual points; parameters appear in the export; nothing is applied invisibly.

### Phase 12 — Manual correction
Scrub to a frame, fix body or nose, add or remove events; downstream results recompute; corrections persist and are labeled as human-touched.
**Validate:** a correction survives reload, changes the affected measure, and is distinguishable from automatic output.

### Phase 13 — Event detection
Hole investigations from nose proximity, dwell, and approach speed, all thresholds exposed with immediate visible consequence. Escape detection from combined progressive-area, proximity, motion, and hole-darkening evidence, with each event showing the evidence behind it. Explicit **censoring** when no escape occurs before the cutoff or the recording ends.
**Validate:** the end-of-clip descent is detected as escape or reported as censored on all three clips — never as a silent "never escaped" with a fabricated latency; mid-platform tracker loss is not labeled an escape.

### Phase 14 — Behavioral measures
Primary and total latency, primary and total errors, path length, speed, time in the target quadrant (with the quadrant convention stated), and search strategy (spatial / serial / random) with reasoning shown and override allowed. Definitions visible in the UI. Censored and assumption-violating cases (for example a non-centre start) are flagged rather than quietly scored.
**Validate:** measures recompute from corrected trajectories; every time value derives from container timestamps; overrides persist.

### Phase 15 — Visualizations
Trajectory overlay styled by time and by provenance, path plot, occupancy heat map, hole-visit raster, and a learning curve across trials. Grayscale-safe, export-resolution output.
**Validate:** figures remain readable printed in grayscale; colour is never the only encoding.

### Phase 16 — Export and analysis bundle
CSV and XLSX with a per-trial summary, per-event detail, and a parameters/version sheet. Save and load the `.neurotrack.json` bundle; recompute measures from a bundle without re-tracking.
**Validate:** opens cleanly in Excel and is readable without a legend; bundle round-trips; the parameters sheet matches the UI.

### Phase 17 — Demo state and submission artifacts
"Load example" reaching real output within about a minute (analysis bundles committed; sample videos linked, not committed). Committed generated outputs for all three clips. README with live URL and demo video at the top, cold-clone setup, data-handling and cost paragraphs, and a "Known limitations" section separating defects from excluded scope. `AI_NOTES.md` maintained. Agent configuration (`.cursor/`) committed, not ignored.
**Validate:** an evaluator sees real results without hunting for files; the demo path covers all three clips end to end.

### Stretch — only after the MVP holds

Cohort batch queue with progress; cross-session template library; inter-rater comparison; model-assisted labeling; MCP server for cohort summaries; SLEAP / DeepLabCut / ezTrack / AnyMaze interop.

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
