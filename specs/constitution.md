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
5. **A circular platform model is sufficient.** Hole-ring circle fits leave ≤2.1 px maximum residual (mean ≤1.0 px); best-fit ellipse axis ratios are 0.984–0.994. No homography or lens undistortion is needed.
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
- **Corrected finding:** `requestVideoFrameCallback` *does* expose a genuine per-frame presentation timestamp (`mediaTime`) and a `presentedFrames` skip-counter — timestamp availability was never the real limitation. A dedicated spike (`spike/phase-0-decode-timing/results/findings.md`) measured the actual constraints instead: it is main-thread-only (no Worker — `HTMLVideoElement` cannot exist off-thread); it delivered fewer callbacks than the container/decoder frame count on every clip without always signaling a gap (`test50`: 5,338 callbacks vs. 5,539 frames, zero `presentedFrames` gaps logged); and wall-clock throughput tracks playback speed rather than beating it (raising `playbackRate` to 4× produced no measured speedup in testing).

WebCodecs gives frame timestamps in microseconds **from the container timebase**, decodes much faster than real time (190–430× on the three sample clips, measured), and runs in a Worker. Support is Chrome/Edge 94+, Firefox 130+ desktop, and Safari 16.4+ for the video interfaces we use (`VideoDecoder`, `EncodedVideoChunk`, `VideoFrame`); it is not Baseline only because Firefox for Android lacks it, which does not affect a desktop analysis tool.

Required: feature-detect with `VideoDecoder.isConfigSupported()` and fall back to `<video>` + `requestVideoFrameCallback` with an explicit, visible notice that analysis will be slower. `<video>` + `requestVideoFrameCallback` remains the human review and scrubbing surface either way — that role never depended on frame-complete delivery or beating real time, only on `mediaTime` being a real timestamp, which it is.

### Spike questions — disposition

| Question | Status |
|---|---|
| **Decode throughput and timestamp exactness** | **Resolved.** All three clips decode with zero decoder errors at 190–430× real-time; `test51` spacing confirmed as exactly 1001/15000 s (median unique-`cts` interval), not 15 fps; frame counts agree across `ffprobe`/`mp4box`/decoder on all three clips. See `spike/phase-0-decode-timing/results/findings.md`. |
| **Escape vs tracking loss** | Resolved directly during MS-5's implementation, at full strength, rather than through a separate throwaway spike — this is the scientific core of the product and is worth building for real the first time rather than prototyping twice. |
| **Nose vs body from geometry alone** | Resolved during MS-3's implementation: a real nose estimate from blob geometry and heading, with explicit rim-occlusion handling. If contour geometry proves insufficient on real footage, an ML pose-estimation step is the documented fallback (see "Deliberately not chosen"). |
| **Video persistence policy** | Decided: content-fingerprint-based re-identification with a bounded blob-cache budget (MS-1). When a video is evicted from cache, the user is re-prompted to reselect the file; geometry, corrections, events, and measures for that trial are unaffected because they live in Dexie independently of the raw video bytes. |

### Deliberately not chosen

- **Any backend** — unnecessary, and it would add auth, hosting, and data-egress problems the user must not inherit.
- **Python / notebook pipeline** — precisely what the facility said it cannot run.
- **Hosted vision API** — would send animal research video off-machine for no benefit the local path cannot deliver.
- **GPU or in-browser ML model** — held in reserve if geometric nose estimation proves insufficient during MS-3; not needed for maze or animal detection, which are already validated.
- **Desktop app (Electron/Tauri)** — breaks "open it in a browser."
- **Ellipse or homography maze model** — measured residuals show a circle is sufficient.

---

## Roadmap

The product is built as six milestones, each a coherent, load-bearing slice of the user's workflow: load a video → review it → define and calibrate the maze → define the trial window → track the animal → assess tracking quality → correct by hand → detect events → compute behavioral measures → visualize → export and save a reloadable analysis. Each milestone can carry its own branch, spec, validation, and review — and each is scoped to its intended finished quality, not a placeholder to be revisited later. MS-1 through MS-6 together are the complete, working pipeline, end to end, on all three supplied clips.

### MS-1 — Foundation, Ingest & Persistence — ✅ Complete

Validated September 5, 2026 on branch `ms-1-foundation-ingest-persistence`, merged to `main`.

The application shell: a Vite + React + TypeScript scaffold under an MIT license, with CI running lint/test/build and deploying to GitHub Pages, and an accessibility baseline (focus order, labeled controls, contrast tokens, 200% zoom) built in from the start rather than retrofitted.

Video ingest is drag-and-drop plus folder selection for multiple files, decoded via the validated WebCodecs `VideoDecoder` + `mp4box.js` pipeline in a dedicated Worker (see "Video decode" above; the decision was validated by a spike under `spike/phase-0-decode-timing/`). Per-video metadata and a timestamp index are built from decoded presentation times, never an assumed frame rate.

Persistence uses a Dexie/IndexedDB schema for trials, parameters, geometry, tracks, and progress, with autosave so a session survives an accidental refresh. Video re-identification uses a content fingerprint with a bounded blob-cache budget; when a video falls out of cache, the user is re-prompted to reselect the file, and everything else about that trial — geometry, corrections, events, measures — is unaffected because it lives in Dexie independently of the raw video bytes.

**Validate:** cold clone builds from README alone and deploys to a working URL; all three clips load and decode without any per-file special-casing; `test51` resolves to 15000/1001, not 15; a mid-session refresh loses nothing; a video evicted from cache and re-selected is recognized as the same trial.

### MS-2 — Review Player, Maze Calibration & Trial Window — ✅ Complete

Validated September 5, 2026 on branch `ms-2-review-player-maze-calibration-trial-window`, merged to `main`.

Frame-accurate scrubbing, frame stepping, and keyboard shortcuts, with a Canvas overlay locked to the displayed frame — the substrate everything else in this milestone, and manual correction later, is drawn on.

Maze calibration is automatic by default: an Otsu platform mask locates the platform, dark-blob candidates around its rim are fit to a least-squares circle, and the 20 hole positions are derived from the fitted ring's own angular spacing (validated at 18.0° ± 0.6°). The user confirms the result, nudges any hole that needs it, and picks the target hole; platform diameter in centimeters drives the pixel→cm scale. Low-confidence auto calibrations require explicit human review acknowledgment before confirmation — hole edits are optional and provenance is preserved per hole. Because a session commonly reuses one physical rig across many trials, geometry from an already-calibrated trial can be applied to another with alignment and per-trial override, so later videos in a session take materially fewer clicks than the first.

The trial window (start, end, protocol cutoff) is proposed automatically from motion onset and confirmed or edited by the user; pre-trial frames are excluded from every downstream measure and clearly marked as such in the UI.

**Validate:** automatic calibration finds 20/20 holes on all three clips, including the off-center, brighter `test51`; applying a template to a second trial measurably reduces clicks versus the first; the overlay matches the displayed frame across keyframe boundaries; proposed trial-window starts land at ~5.0 s on all three clips without mistaking `test51`'s start cylinder for the animal; distances report in cm. All criteria exercised by `npm run validate:ms2` (V1–V20) plus offline `npm run validate:calibration`.

### MS-3 — Tracking & Quality Assessment

A Worker pipeline: per-pixel median background modeling (required because intra-platform lighting is measurably uneven — a single global threshold does not work), per-pixel differencing, morphology, and animal-blob selection gated on size and shape to reject non-animal foreground objects such as `test51`'s start cylinder. From the blob, the pipeline derives a body centroid and a true nose estimate from contour geometry and heading, with explicit handling for rim occlusion, where the animal is partially cut off by the hole it is investigating. If geometric nose estimation proves insufficient on real footage, an ML pose-estimation step is the documented fallback (see "Deliberately not chosen").

Each frame's observation carries a status that distinguishes **tracked**, **absent — inside a hole**, **absent — pre-trial**, and **lost**, because a tracker losing the animal and the animal actually entering the escape box must never look the same to downstream code. Tracking runs show progress and support cancel and resume.

Quality assessment is a first-class output of this milestone: per-video fractions tracked / lost / absent / interpolated, and a timeline strip showing where failures cluster with click-through to the exact frame, so a user can decide whether to trust a video before building a figure on it.

**Validate:** trajectories produced on all three clips; the start cylinder is never tracked as the animal; nose and body diverge visibly during rim investigations; the four observation statuses are correctly separated on hand-checked segments; a user can identify, from the quality report alone, which stretches of a trial to distrust.

### MS-4 — Manual Correction & Trajectory Cleaning

Manual correction is mandatory and non-negotiable: the user scrubs to a frame, sees the overlay, fixes the body or nose point or adds/removes an event, and every downstream result — cleaning, events, measures, visualizations, exports — recomputes from it. Corrections persist across reload and are visibly labeled as human-touched, distinguishable from automatic and interpolated output at every point downstream.

Trajectory cleaning — gap filling, smoothing, and outlier rejection — exposes every parameter to the user, defaults to conservative values, and previews its effect live before it is applied; nothing is ever applied invisibly. Each point in the cleaned trajectory carries its own production method (`auto`, `interpolated`, `smoothed`, or `manual`), so provenance survives every later transformation.

**Validate:** a correction survives reload, changes the affected measure, and remains visually distinguishable from automatic output; interpolated spans are visually distinct from tracked and manual points; changing a cleaning parameter visibly changes the previewed trajectory before the user commits to it; parameters appear in the export.

### MS-5 — Event Detection & Behavioral Measures

Hole investigations are detected from nose/body proximity, dwell time, and approach speed, with every threshold exposed and its consequence immediately visible when changed. Escape detection combines progressive area loss, proximity to a hole, loss of motion, and darkening of the hole region — because no clip in hand shows the animal's blob vanishing outright, and a binary present/absent rule would report "never escaped" for all three. Every event shows the evidence behind it. When no escape occurs before the protocol cutoff or the recording ends, the result is explicitly censored and flagged — never silently emitted as a latency equal to clip duration.

From detected events, the pipeline computes primary and total latency, primary and total errors, path length, speed, time in the target quadrant (with the quadrant convention stated), and a search-strategy classification (spatial / serial / random) with its reasoning shown and an override the user can apply. Assumption-violating cases — for example a trial that doesn't start at the platform center — are flagged rather than quietly scored.

**Validate:** the end-of-clip descent on all three clips is detected as escape or reported censored, never a silent "never escaped"; mid-platform tracker loss is never labeled an escape; changing a threshold visibly changes the event count; measures recompute from corrected trajectories with every time value from container timestamps; strategy overrides persist.

### MS-6 — Visualization, Export & Reloadable Analysis

Visualization is generous, per the brief: a trajectory overlay styled by time and by provenance, a path plot, an occupancy heat map, a hole-visit raster over the trial, and a learning curve across a session's trials — all grayscale-safe and rendered at export resolution, because these are the figures a scientist will screenshot into a paper.

Export produces CSV and XLSX with a per-trial summary, per-event detail, and a parameters/version sheet, readable in Excel without a legend. The `.neurotrack.json` analysis bundle documents the full intermediate representation and can be saved and reloaded to recompute measures without re-tracking, so a facility can revisit an analysis as definitions evolve.

**Validate:** all five visualization types render for all three clips and remain readable printed in grayscale; CSV/XLSX open cleanly in Excel with a parameters sheet matching the UI; a saved bundle reloads and reproduces the same displayed measures without re-tracking.

---

### Delivery and documentation requirements

Independent of any single milestone, the finished product requires:

- A live deployment (GitHub Pages) reachable by URL — no install, server, or account for the user.
- A `README.md` with the live URL and a demo video at the top, cold-clone setup instructions, data-handling and cost paragraphs, and a "Known limitations" section that separates genuine defects from deliberately excluded scope, named specifically rather than left implicit.
- An `AI_NOTES.md`, kept current, describing the tools/models used and specific moments of disagreement with or correction of agent output.
- A "Load example" seed state that reaches real computed output quickly, for all three clips, without requiring the user to create anything first.
- Generated outputs (per-trial summary, per-event detail, `.neurotrack.json` bundle) for `test50`, `test51`, and `test53` committed to the repository; the sample videos themselves are linked, not committed.
- A demo video, 2–3 minutes, showing all three clips analyzed end to end including a manual correction, without editing out slow or awkward parts.
- An accessibility validation pass — keyboard-only reachability, contrast, 200% zoom — exercised before considering the product finished, not merely designed for.
- Agent configuration (`.cursor/`) committed, not gitignored.
- A permissive license (MIT).

### Stretch — beyond the core product

Cohort batch queue with progress; a cross-session template library (beyond the single-session template reuse in MS-2); inter-rater comparison; model-assisted labeling; an MCP server or agent skill for cohort summaries; interoperability with SLEAP / DeepLabCut / ezTrack / AnyMaze exports. The Salk brief itself lists these as "if you have room" — they are valuable future extensions, not part of the core product's quality bar.

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

Before any milestone is called complete:

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
