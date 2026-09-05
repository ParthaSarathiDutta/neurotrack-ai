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
