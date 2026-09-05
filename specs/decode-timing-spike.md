# Phase 0 — Decode and Timing Spike

Branch: `phase-0-decode-timing-spike`
Constitution reference: `specs/constitution.md` → Roadmap Phase 0, and the "Video decode" / "Open — resolve by spike" tech-stack sections.

## Purpose

Every later phase depends on how video frames reach the pipeline and what timestamp is attached to each one. Before writing any product code, this spike must determine, with evidence from all three supplied clips, whether the constitution's decode architecture is actually correct — not just plausible.

Throwaway harness code is expected and acceptable. The **decision** this phase produces — primary decode path, timestamp derivation rule, frame-count reconciliation rule, fallback trigger and its honest limitations — is not throwaway and will be binding on Phase 2 onward.

No product UI, no persistence, no Phase 1 scaffolding. This spike does not touch `src/` for the eventual app; it lives entirely under `spike/phase-0-decode-timing/`.

---

## Plan

1. **Scaffold an isolated harness**, outside any future app structure:
   `spike/phase-0-decode-timing/` — a static HTML page, a plain JS module (no TypeScript, no bundler, no framework — this is throwaway), and a dedicated Worker script. `mp4box.js` is the only dependency, installed locally for this spike only (`npm install mp4box` inside the spike folder, or a vendored build) so it can run with a trivial static file server and no build step.

2. **Harness input:** a multi-file `<input type="file">` (not a hardcoded path to `data/barnes-maze/`), so the harness works the same way regardless of git-ignored video files being present, and previews the eventual drag/drop UX rather than depending on a dev-only fetch path.

3. **Primary path (Worker):** for each of the three files —
   - Demux with `mp4box.js`: read `onReady` info (movie + per-track `timescale`, `duration`, `nb_samples`, `codec` string), extract the codec description box (`avcC`/`hvcC`) from `stsd` dynamically (never a hardcoded byte offset — see Decisions), and stream samples via `onSamples`.
   - Feed each sample into a `VideoDecoder` inside the Worker as an `EncodedVideoChunk`, using the sample's own `cts` (composition timestamp) in the track's timescale, not an assumed frame index.
   - On each decoder `output`, record: our sequence number, the `VideoFrame.timestamp` (µs) WebCodecs reports back, the source sample's `cts`/timescale-derived time, and release the frame (`frame.close()`) after capturing one thumbnail per video for a visual sanity check.
   - Measure wall-clock decode time per video.

4. **Cross-check against known container facts**, gathered independently via `ffprobe` before this phase (recorded below) — the harness must reproduce or explain any disagreement, not just report its own numbers in isolation.

5. **Fallback path (main thread, required by spec):** `<video>` + `requestVideoFrameCallback`, for the same three files —
   - Record `metadata.mediaTime`, `metadata.presentedFrames`, and wall-clock time to reach end-of-media at normal playback rate.
   - Detect and log any gap in `presentedFrames` (a skipped frame), and note whether the run kept pace with the clip's own duration (it structurally cannot beat it — see Decisions).

6. **Produce a findings artifact** (a markdown or JSON report saved under `spike/phase-0-decode-timing/results/`) with the per-video numbers needed to evaluate every validation criterion below, plus the three thumbnails, plus whatever disagreements were found. This artifact — not the harness code — is what gets reviewed before Phase 1.

7. **Do not** wire this into the app, add it to CI, or start Phase 1 scaffolding. Stop at the findings artifact and report.

---

## Requirements

Testable claims this spike must resolve, each traceable to a validation criterion below.

| # | Requirement |
|---|---|
| R1 | `WebCodecs VideoDecoder` + `mp4box.js` demuxing, running inside a dedicated Worker, decodes `test50.mp4`, `test51.mp4`, and `test53.mp4` to completion without decoder errors. |
| R2 | The presentation timestamp recovered for each frame comes from the **track's own timescale and sample `cts`**, not from any assumed or rounded frame rate, and matches the container's own timebase as reported by `ffprobe` (recorded below). |
| R3 | `test51`'s frame spacing is recovered as exactly `1001/15000 s` per frame (≈14.985 fps) — not silently rounded to `15 fps`, and not off by the ~0.44% error that rounding would introduce. |
| R4 | Three independent frame-count sources are captured per video — the `ffprobe nb_frames` container tag, `mp4box.js`'s sample-table count (`nb_samples`, derived from `stsz`/`stsc`, structurally authoritative for a well-formed MP4), and the actual count of `VideoDecoder` output callbacks — and any disagreement between them is recorded, not silently resolved by picking one. |
| R5 | Decode throughput in a Worker is fast enough that the pipeline is not the bottleneck of the "no twenty-minute wait" usability requirement — concretely, meaningfully faster than real-time playback on `test50` (185 s of source video). |
| R6 | The `<video>` + `requestVideoFrameCallback` fallback is exercised end-to-end on all three clips, and its actual (not assumed) capabilities and limits are documented with evidence, correcting the constitution wherever it turns out to be wrong (see Decisions, D7). |
| R7 | The codec description (`avcC`/`hvcC`) and coded dimensions used to configure `VideoDecoder` are extracted from the container's `stsd` entry programmatically for each file, never hardcoded — since the three sample files may not share identical SPS/PPS parameters, and future videos from other rigs certainly will not. |
| R8 | Feature-detection for choosing primary vs. fallback path is based on `typeof VideoDecoder !== 'undefined'` and `VideoDecoder.isConfigSupported()` against the file's actual codec string, not a browser/UA sniff. |

---

## Decisions

Decisions this spike is expected to confirm, correct, or make outright. Anything marked **(pending spike evidence)** is a hypothesis to be tested, not yet a commitment.

- **D1 — Demux with `mp4box.js`, not a hand-rolled parser.** It is the library the official WebCodecs samples use for exactly this purpose, exposes per-track `timescale`/`duration`/`nb_samples` directly from the container's own boxes, and needs no DOM (works in a Worker).

- **D2 — Extract `avcC`/`hvcC` dynamically per file, strip only the real box header.** A hardcoded 8-byte offset is a known failure mode (confirmed against multiple real-world reports of "Failed to parse avcC" from exactly this mistake — header size is not always 8 bytes). The harness must locate the box, write it via `mp4box`'s own `DataStream`, and slice off that box's actual reported header length.

- **D3 — Coded dimensions come from the `stsd` `VisualSampleEntry`, not `track.video.width/height` or `track_width/height`.** The latter two can carry a display-aspect-ratio adjustment distinct from the actual coded picture size, which has caused `isConfigSupported` mismatches in the wild. The spike must verify which of these agree or disagree on our three (square-pixel, 640×480) clips rather than assuming they're interchangeable.

- **D4 — Every timestamp is `cts / track.timescale` seconds, stored as an integer microsecond `timeUs` per the constitution's data model.** No fps constant is used anywhere in the timing path. This is the mechanism that is supposed to make R3 true; the spike proves whether it actually does.

- **D5 — Frame count has no single authority; disagreement is a first-class signal.** The constitution already states this (finding #11: decoded 5,553 vs. reported `nb_frames` 5,539 for `test50`, found via a raw `ffmpeg` pipe, not via `mp4box`/`VideoDecoder`). This spike re-derives the count via the actual production mechanism (`mp4box` sample table + `VideoDecoder` output count) to see whether it agrees with `mp4box`'s number, with `ffprobe`'s tag, with neither, or with both — and whichever combination we see becomes the reconciliation rule for Phase 2's ingest warnings.

- **D6 — Demux and decode run entirely inside a dedicated Worker.** Only decoded thumbnails/preview frames cross back to the main thread (via transferable `VideoFrame`/`ImageBitmap`), so the UI thread is never blocked by decode work, matching the constitution's Worker-isolation principle.

- **D7 — Correction to the constitution's fallback-path claim.** The constitution states `<video>` "does not expose reliable per-frame presentation timestamps." Checked against the current `requestVideoFrameCallback` specification: this is **not accurate**. Its callback metadata includes `mediaTime` — a genuine presentation timestamp, in seconds, on the media timeline, plus a `presentedFrames` counter that reveals skipped frames. The actual, verified limitations of the fallback path are different from what the constitution says:
  - **Main-thread only.** `HTMLVideoElement` is a DOM element; it cannot exist in a Worker. Any fallback pipeline's frame-production loop must run on the main thread, contradicting the "decode happens in a Worker" principle for this path specifically. (Decoded frames could still be handed to a Worker per frame via a transferable `ImageBitmap`, at a per-frame `postMessage` cost.)
  - **Throughput-bound to real time.** The callback fires at the lesser of the video's own frame rate and the display refresh rate, and is tied to actual playback. There is no way to use `rVFC` to decode `test50` faster than its own 185 s runtime — the opposite of what R5 requires for the primary path.
  - **Silent frame loss is possible and must be caught, not assumed away.** Frames can be skipped under load; `presentedFrames` reveals this only as a gap, with no way to recover the missed frame.

  The spike must confirm this correction with actual measurements (D7 also folds in R6) and the constitution's wording should be corrected accordingly once confirmed — timestamp *availability* was never the real problem; throughput and main-thread confinement are.

- **D8 — Fallback trigger is per-file feature detection**, not a one-time browser check: `typeof VideoDecoder === 'undefined'` OR a rejected `VideoDecoder.isConfigSupported({ codec, codedWidth, codedHeight, description })` for that file's actual extracted codec string and description.

### Container facts already gathered (via `ffprobe`, for cross-checking — not a substitute for this spike)

| | `test50.mp4` | `test51.mp4` | `test53.mp4` |
|---|---|---|---|
| `nb_frames` (tag) | 5539 | 741 | 905 |
| `r_frame_rate` | 30/1 | **15000/1001** | 30/1 |
| `time_base` | 1/15360 | 1/15000 | 1/15360 |
| `duration` (s) | 185.066667 | 49.382667 | 30.233333 |

These are container-metadata tags read by a general-purpose prober, not values produced by `mp4box.js` or `VideoDecoder`. Whether `mp4box`'s per-track `timescale` matches `time_base`'s denominator, and whether its `nb_samples` matches `nb_frames`, is exactly what this spike must check rather than assume.

---

## Validation

Pass/fail criteria, evaluated per video unless noted. All three clips must be checked for every criterion — a pass on one or two is not a pass.

| # | Criterion | Pass condition |
|---|---|---|
| V1 | Worker decode completes | `VideoDecoder` reaches `flush()` with no `error` callback fired, for all three files. |
| V2 | Timestamp derivation is timebase-correct | Recovered mean inter-frame interval for `test51` is `1001/15000 s` (≈0.066733...s) within 1 µs — not `1/15 s` (0.066667s). The two differ by ~0.44%; the spike must show the *correct* one is produced, and show the calculation path (timescale + cts), not just a plausible-looking number. |
| V3 | No fps assumption anywhere in the timing path | Code review of the harness confirms no literal `15`, `30`, or `fps` constant is used to compute any timestamp; all timestamps trace to `mp4box` `timescale`/`cts` fields. |
| V4 | Frame-count reconciliation is explicit | For each video, the report lists all three counts (`ffprobe nb_frames`, `mp4box nb_samples`, `VideoDecoder` output count) side by side. Any disagreement is called out by name in the report; none is silently preferred without justification. |
| V5 | Throughput clears the usability bar | Worker decode of `test50` (185 s of source) completes in **under 30 s** wall-clock (≥ ~6× real-time) on ordinary development hardware. A result slower than real-time (≥185 s) is an outright fail of the primary-path decision. |
| V6 | avcC/hvcC and coded size are never hardcoded | Harness source contains no fixed byte-offset slice and no literal `640`/`480` dimension constant; both are read from each file's own `stsd` entry, and the report states whether `VisualSampleEntry` dimensions agreed with `track.video`/`track_width` for our files. |
| V7 | Fallback path is measured, not assumed | The report states, with numbers: whether `mediaTime` was present and monotonic per callback (confirming or refuting the constitution's current claim); the wall-clock time for the fallback to reach end-of-media on each clip (expected: ≈ the clip's own duration, refuting any claim it can be faster); and whether any `presentedFrames` gap (skipped frame) occurred on any clip. |
| V8 | Feature detection is per-file | Harness calls `VideoDecoder.isConfigSupported()` with each file's *own* extracted codec/description/dimensions before deciding primary vs. fallback for that file — not a single up-front browser check. |
| V9 | Findings are written down before any Phase 1 work starts | `spike/phase-0-decode-timing/results/` contains the report plus one saved thumbnail per video, committed on this branch, before any `src/` app scaffolding exists. |

A failing result on V2, V5, or V7 is grounds to revisit the constitution's primary-path decision, not to route around it quietly — consistent with the project rule that assumptions are corrected explicitly, not patched over.
