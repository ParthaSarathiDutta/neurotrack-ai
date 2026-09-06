# AI Notes

## MS-2 manual review fix — test51 calibration (2026-03-21)

### Mistake
`ringFit.ts` refined the ring center by **averaging matched candidate x/y positions**. Points lie on a circle, so their centroid is pulled toward the arc — on test51 this shifted the center ~20 px from the true hole-ring center (304,253 vs 284,244) while the candidate circle fit was already accurate (~2 px). The misleading ~23.79 px “ring-fit residual” was a symptom of wrong center/phase, not bad blob extraction.

### Rejected approach
Raising `MAX_RING_FIT_RESIDUAL_PX` to 25 to pass poor geometry — explicitly rejected per manual review.

### Fix validated
- Geometric circle-fit refinement (never centroid-average center)
- Multi-offset dark threshold sweep + circle-fit-based radial filtering
- Dark-centroid sub-pixel refinement
- Letterbox-aware overlay transform (`object-fit: contain`)
- Confidence tiers (`high` / `low` / `failed`) from slot residuals, not hole count alone
- Offline `npm run validate:calibration` + MS-2 V16

### Trial window silent failure on test53 (2026-03-21)
When motion onset returned null, service still returned a "proposal" with `startTimeUs: null` and status text "0.00 s" — UI field stayed blank with no panel error. Switching exclusively to frame-worker decode also caused all-three failure in headless CI when worker decode failed on sampled indices.

Fix: hybrid worker+video-seek capture; active-pixel motion metric (rim-sensitive); noise floor from 0–4.5 s quiet window with trimmed median; `detectionFailureReason` banner on failure; V17/V18 validation.

### Tangential shadow bias in hole centroids (2026-03-21)
Connected-component blob centroids smear tangentially under platform lighting (~−2.5 px x). Fix: post-fit `radialApertureCenter()` on platform radials.

### MS-2 final correctness — per-trial leakage + trial-start regression (2026-03-21)

**Problem 1 — identical calibration metrics after trial switch**
Manual browser review: test51 showed test53's residuals (4.24 / 2.11 / 2.04 px, high confidence) after switching trials.

**Root cause:** `initFrameDecoder()` had no serialization — concurrent inits when switching trials or overlapping with `useVideoPlayer` could leave the worker on video A while `getFramePixels(0)` served frames to a calibration for trial B. React also reused panel state without `key={trial.id}`.

**Fix:** Serialize worker init via promise chain; fingerprint-guard all `getFramePixels`/`getFrameBitmap` calls; operation-sequence guards in store; `key={trial.id}` + panel reset on trial change; V19 multi-trial switch/reload isolation test.

**Problem 2 — premature trial-start (4.30 s / 3.67 s) in interactive UI**
Validation harness ~5.0 s; browser ~4.3 s / 3.67 s with confidence 1.00.

**Root cause:** Trial-window sampling merged separate quiet (0–4.5 s) and scan (3–7 s) index lists into one sorted array, creating **large temporal gaps between consecutive decoded frames**. Frame diffs across multi-second gaps produced false motion at ~3.7–4.3 s. Confidence formula saturated at 1.00 without timing plausibility.

**Fix:** Single evenly spaced timeline sample (0–7 s) with consecutive pairs; noise floor from pairs < 4.0 s only; onset scan restricted to ≥ 4.5 s; confidence penalizes timing distance from expected ~5 s. Renamed "Trial duration" → "Proposed trial duration".

**Validated:** lint/test/build PASS; validate:ms2 V1–V19 PASS; test51 now shows low confidence / 6.35 px max residual distinct from test53.

### Low-confidence confirmation UX (2026-03-21)
Rejected requiring manual hole nudge before confirm — scientifically wrong when overlay is visually acceptable. Replaced with explicit `calibrationReviewAcknowledgedAt` acknowledgment checkbox; per-hole provenance unchanged unless user actually nudges.

## MS-3 tracking — WebCodecs sample buffer detachment (2026-03-21)

### Mistake
Initial tracking worker demuxed all MP4 samples into an array, then ran separate `VideoDecoder` sessions per background frame / batch. `EncodedVideoChunk` transfers underlying `ArrayBuffer`s; after the first decode session, later sessions hit `Decoding error` immediately (failed on test53 bg sample 2/30 at index 176 in ~0.1 s).

### Rejected approach
Falling back to per-frame `frameService.getFramePixels()` on the main thread — would work but is far too slow for test50 (~5539 frames) and sidesteps the spec’s dedicated tracking worker.

### Fix validated
- Tracking worker uses **ingest-worker’s demux+decode-in-`onSamples` pattern** twice (background pass, tracking pass), feeding `sample.data` directly from mp4box without storing compressed buffers across sessions.
- `frame-worker.ts` stores sample bytes as `Uint8Array` and passes `data.slice()` into each chunk so interactive stepping survives multiple seeks.
- `mp4-utils.ts` copies codec description bytes so decoder config survives after mp4box teardown.

### test51 tracking quality
Cylinder occlusion yields ~66% tracked with many provisional `absent_in_hole` labels (D7 heuristic — not escape detection). Offline validation passes (>60% tracked, >50% in first 5 s after start). Browser MS-3 validation completes; quality tier **low** — expected for this clip until MS-4+ correction.

## MS-3 manual review correction pass (2026-09-06)

### Mistake 1 — nose estimation trusted a corner pixel
`localWidthAtExtremity` measured cross-sectional width **exactly at** the blob's PCA-axis extremity, which is often a single corner/tail-tip pixel — an unreliable, noisy sample. This let contradictory-shape frames (e.g. test53 frame 275) still emit a confident nose point near the hip. Fix: sample width at an **inset** point a few pixels back toward the centroid (`TRACKING_NOSE_WIDTH_INSET_PX`), and require heading↔shape-axis alignment above a real threshold before ever emitting `noseXY`; otherwise return `null`. Validated: nose now emitted on only 11–28% of tracked frames across the three clips (was emitted much more liberally, including wrong points), unit tests cover consistent/contradictory heading and rim-clipped blobs.

### Mistake 2 — `absent_in_hole` conflated "near any hole" with "actually disappeared"
The original heuristic flagged `absent_in_hole` whenever the last known position was near a rim/hole band, using a shrink-only check that missed the "slows down but doesn't shrink" disappearance pattern. This produced 167 `absent_in_hole` frames on test51 — implausibly high, and not reviewable. Fix: require **either** area shrinkage **or** velocity deceleration (`showedDisappearanceEvidence`) *and* proximity specifically to the confirmed target hole (or any hole if the target is still unknown) before labeling `absent_in_hole`; otherwise `lost`. Validated via live-UI run: test51 tracked fraction is unchanged (73.3% → 73.4%, within noise — confirms body tracking untouched), `absent_in_hole` 167 → 0, with those frames now honestly bucketed as `lost` (11 → 177). This status remains explicitly provisional and does not implement MS-5 escape detection.

### Rejected approach — silent Hole 1 fallback
`confirmTargetHole` used to `?? 0` when nothing was selected, meaning an operator could accidentally confirm "Hole 1" as the target without ever selecting anything (this happened during manual review of test51). Target identity is a protocol fact the app cannot infer from geometry. Fixed by making an unresolved selection a no-op with a status message, disabling the confirm button until a hole is chosen, and adding a `clearTargetHole` action/button so a confirmed target can be returned to "unknown."

### Real bug found while writing validation for the above — trial reselection broke frame decoding
While chasing an apparent "washed-out frame" report at test51 frame ~115, discovered `selectTrial` unconditionally called `clearFrameCache()` (nulling the active decoder fingerprint) even when re-selecting the **already active** trial. Nothing re-runs `initFrameDecoder` in that case, since `VideoPlayer` only remounts when the fingerprint prop actually changes — so re-clicking the current trial permanently breaks frame stepping until a different trial is selected. Fixed by making `selectTrial` a no-op when `id === selectedTrialId`. The original frame-115 "washout" was actually a separate, already-fixed decode-order bug in `frame-worker.ts` (chunks must be fed to `VideoDecoder` in decode order, not presentation/CTS order, for streams with B-frames); with both fixes in place, `test51` frames 105–125 show consistent luminance stats (no washout) end to end.

### Rejected approach — trusting `page.waitForFunction(fn, {timeout})` for a zero-arg `fn`
Playwright's `waitForFunction(pageFunction, arg, options)` treats a bare `{timeout}` object as the browser-side `arg` (unused by a zero-parameter function) when only two arguments are passed — `options` is left `undefined` and the call silently falls back to Playwright's 30s default timeout. This was present in `validate-ms1/ms2/ms3.mjs` and `ingest-summary.mjs` for every long-running wait (ingest, calibration, trial-window, tracking). It only surfaced now because `test50`'s tracking pass legitimately takes ~45s — longer than the silently-applied 30s cap — while every other wait in these scripts happened to resolve under 30s anyway, masking the bug for months. Fixed by explicitly passing `undefined` as `arg` everywhere a >30s timeout was intended.

### Validated
lint/test/build PASS; `validate:calibration`, `validate:ms1`, `validate:ms2`, `validate:ms3`, `validate:tracking` all PASS. Live-UI (WebCodecs) tracking re-run on all three clips with target hole left **unconfirmed**: test53 99.6% tracked / 0 `absent_in_hole` (high), test51 73.4% tracked / 0 `absent_in_hole` / 177 lost (low), test50 97.2% tracked / 28 `absent_in_hole` / 124 lost (high). Category-based review UI (`flagged-category-*`) and "Go to frame" input verified end-to-end in `validate-ms3.mjs`.

## MS-3 follow-up — rim tracking + hole-disappearance honesty (2026-09-06)

### Problem 1 — test51 visible rim frames marked `lost`
Manual frames ~181, ~270, ~334, ~672, ~681 showed a visible mouse near the rim/hole but no body position. Root causes: (a) single-channel foreground diff weakened near dark holes, (b) strict blob compactness/area gates rejected partial rim blobs, (c) continuity window too narrow for reacquisition after rim interaction.

**Fix:** max-channel foreground diff + slightly expanded segmentation ROI; rim-relaxed second-pass blob selection (lower min area/compactness, wider continuity) only when the animal was recently tracked near the rim or a hole opening (`rimGeometry.ts` + `blobSelection.ts`). Offline tracked fraction test51: 66.2% → **90.0%**; all five manual spot frames now `tracked`.

### Problem 2 — test50 false provisional `absent_in_hole`
Manual frames ~573, ~586, ~592, ~2047, ~2051 still had a visible mouse but were classified `absent_in_hole` because a single missed detection near a hole plus partial area shrink satisfied the old heuristic.

**Fix:** temporal gate in `observationStatus.ts` + extended `TrackerState`: requires ≥3 consecutive missing frames, ≥2 prior tracked frames near a hole opening, last tracked area ≤45% of recent peak, plus existing shrink/slow evidence. Partial shrink while a substantial blob may still be visible → `lost`. Combined with rim tracking improvements, test50 absent_in_hole: 28 → **0**; all five manual spot frames now `tracked`.

### Review UX simplification
Scientist-facing review panel collapsed from six granular categories to three broad groups (Tracking issues, Pose uncertainty, Hole disappearance). Granular per-flag counts retained under Technical details; each frame in a group lists its specific reasons inline.

### Validated
All manual spot-check frames pass in `validate:tracking`. test53 unchanged at 100% tracked (high). Full lint/test/build + all validation scripts PASS.

## MS-3 final diagnostic — metric consistency + timestamp integrity (2026-09-06)

### Problem 1 — live UI 100% tracked vs offline validate:tracking ~90%/97%
**Root cause (offline script stale setup, not live UI inflation):**
1. `buildIndexFromProbe()` synthesized timestamps from `ffprobe r_frame_rate` as if `cts = i * num, timescale = den`. That is wrong — `r_frame_rate` is a display rate label, not the sample-table tick pattern. For test50 (`time_base 1/15360`, delta 512) this produced ~30 s per frame instead of ~33 ms; for test51 (`15000/1001`) ~15 s per frame instead of ~66.7 ms.
2. Hardcoded `startTimeUs = 5_000_000` instead of motion-onset detection (~5.067 s test50/test53, ~5.205 s test51). Wrong timestamps shifted which frames counted as in-trial and which were sampled for background.

**Fix:** shared `scripts/lib/mp4TimestampIndex.mjs` (mp4box + `buildTimestampIndex`, same as ingest-worker) and `scripts/lib/offlineTrialWindow.mjs` (same motion-onset path as live UI). After fix, offline metrics match live UI: **100% tracked / 0 lost / 0 absent_in_hole** on all three clips.

**Rejected:** lowering offline thresholds to match UI without fixing the validation path.

### Problem 2 — adjacent frames showing identical timestamps in review UI
**Findings (both causes present):**
- **Real duplicates:** container has multiple samples with identical `cts` (test50: 162 adjacent duplicate `timeUs` pairs; test51: 17; test53: 25). Index is still monotonic non-decreasing; duplicates are valid container behavior, not rounding.
- **Display-only collisions:** e.g. test50 frames 199/200 have distinct `timeUs` (6700000 vs 6700065) but both showed "6.700 s" at 3-decimal formatting in flagged-frame list.

**Fix:** `formatPresentationTimeSeconds()` (6 decimals) in flagged-frame list and proposed trial-start display; `frame-worker.ts` disambiguates duplicate-CTS frames when matching decoder output (Nth timestamp match). Regression tests in `tests/timestampIntegrity.test.ts`.

### test51 trial start shift (~5.07 s / 0.91 → ~5.205 s / 0.74)

**Git-bisected cause (same branch, reproducible):**
- `653fd83` (parent of frame-worker fix): `validate:ms2` → test51 **5.072 s / confidence 0.91**
- `8eb266b` (`Fix frame-worker.ts: feed VideoDecoder in decode order`): `validate:ms2` → test51 **5.205 s / confidence 0.74**
- Current HEAD matches `8eb266b` onward.

**Mechanism:** Motion-onset detection decodes ~48 evenly spaced frames in 0–7 s via `frame-worker` (`trialWindowService.captureFramesForTrialWindow`). Before `8eb266b`, samples were sorted by CTS before decode, corrupting B-frame GOP output for test51. False/spurious pixel diffs in the 4.5–5.1 s window triggered onset ~5.07 s with high confidence. After the fix, decoded pixels are correct; the first sustained rim motion for test51 appears ~5.205 s (cylinder drop), and confidence drops because that timing is farther from the expected ~5.0 s prior.

**5.205200 s is the intended current detector output** — not a regression. test50/test53 remain ~5.067 s / ~0.92 because their motion onset is less affected by the decode bug.

### Validated
lint/test/build PASS; validate:calibration, validate:ms1, validate:ms2, validate:ms3, validate:tracking all PASS. MS-3 **not merged / not marked complete** — stopped for review.

