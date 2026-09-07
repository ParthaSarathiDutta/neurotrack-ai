# MS-4 — Manual Correction & Trajectory Cleaning

Branch: `ms-4-manual-correction-trajectory-cleaning`
Base: `main` @ `8379a91` (MS-3 complete)
Constitution reference: `specs/constitution.md` → MS-4
Status: **Implemented — pending manual review** (not merged)

## Requirements

### A. Manual trajectory correction

| # | Requirement |
|---|---|
| RA1 | From the review player, the scientist can correct the **body** position for an exact frame (`frameIndex` identity). |
| RA2 | The scientist can set, adjust, or **remove** a **nose** point when needed; never fabricate nose where evidence is absent unless explicitly placed. |
| RA3 | Manual corrections are **visually distinguishable** from automatic points (marker shape/style by `origin`). |
| RA4 | Corrections **persist across reload** via Dexie session migration. |
| RA5 | **`frameIndex`** is the correction key; **`timeUs`** is copied from the timestamp index for timing only. |
| RA6 | Raw automatic tracking (`track.observations`) is **never overwritten**; corrections live in `track.manualCorrections`. |
| RA7 | Downstream display and cleaning consume **effective observations** (raw + corrections + optional cleaning). |

### B. Trajectory cleaning

| # | Requirement |
|---|---|
| RB1 | **Short-gap interpolation** fills only eligible `lost` gaps (≤ configurable frame count **and** elapsed `timeUs` bound) between frames with body positions. |
| RB2 | **Smoothing** (moving average) is optional and parameterized; never overwrites manual corrections; does not span absence boundaries or unsupported gaps. |
| RB3 | **Outlier handling** flags/replaces implausible jumps using container `timeUs` deltas; replaced frames get explicit `speed_outlier_replaced` flag. |
| RB4 | Long gaps, `absent_pre_trial`, `absent_in_hole`, and unsupported spans are **not** silently filled. |
| RB5 | **Nose is never interpolated or smoothed** — body only. |
| RB6 | Cleaning parameters are **visible, editable**, and stored with applied results. |
| RB7 | User **previews** cleaned trajectory before **Apply**; **Discard** leaves prior state unchanged. |
| RB8 | Applied cleaning stored separately in `track.appliedCleaning`; raw + manual layers preserved; marked **stale** when inputs change. |
| RB9 | Re-running raw tracking clears corrections and cleaning (new raw run supersedes derived layers). |

### C. UX

| # | Requirement |
|---|---|
| RC1 | Compact panel: enter correction mode, pick body/nose/remove-nose, reset frame to automatic. |
| RC2 | Click overlay to place correction at current frame; jump-to-frame from quality report still works. |
| RC3 | Legend explains auto / manual / interpolated / smoothed markers. |
| RC4 | Cleaning: adjust parameters → Preview → Apply or Discard. |
| RC5 | Keyboard-accessible controls; `data-testid`s for Playwright validation. |

### D. Persistence & recomputation

| # | Requirement |
|---|---|
| RD1 | `manualCorrections` and `appliedCleaning` persist through `migration.ts`. |
| RD2 | Parameter changes recompute **preview only** until Apply. |
| RD3 | Raw tracking is not re-run for correction or cleaning. |
| RD4 | Session-level `AnalysisParams.cleaning` holds default cleaning parameters. |

### E. Scope boundary

| # | Requirement |
|---|---|
| RE1 | **No MS-5** event detection, escape classification, behavioral measures, or search-strategy logic. |
| RE2 | **No manual event editing** — events do not exist yet; documented as MS-5 dependency. |

---

## Decisions

### D1 — Three-layer trajectory model

1. **Raw** — `track.observations` from MS-3 (`origin: 'auto'`, immutable after tracking completes).
2. **Manual** — `track.manualCorrections[]` keyed by `frameIndex`; effective layer sets `origin: 'manual'`.
3. **Cleaned** — `track.appliedCleaning.observations` with `origin: 'interpolated' | 'smoothed'`; manual frames always win.

Preview cleaning lives in session store only until Apply.

### D2 — Timing vs identity (unchanged from MS-3)

- `frameIndex` = unique presentation-order identity.
- `timeUs` = authoritative container timing; may duplicate across frames.
- All speed/gap logic uses adjacent `timeUs` values, never frame index / assumed FPS.

### D3 — Conservative cleaning defaults

- `maxGapFrames: 3` — at most 3 consecutive missing body frames eligible for interpolation.
- `maxGapDurationUs: 500_000` (0.5 s) — elapsed-time bound between bracket frames; both frame count **and** duration must pass.
- `smoothingWindow: 3` — odd-length moving average on body only.
- `outlierSpeedMultiplier: 2.0` — relative to tracking `maxPlausibleSpeedPxPerSec`.

### D4 — Provenance is never silent

`origin` on every displayed point reflects how coordinates were produced. Quality metrics remain computed from **raw** MS-3 output; cleaning does not rewrite `track.quality`. Cleaning adds typed quality flags (`gap_interpolated`, `speed_outlier_replaced`, `duplicate_pts_spatial_estimate`) without overwriting raw `observed` status.

### D5 — Applied cleaning staleness

Applied cleaning is **consumable** only when `appliedCleaning.stale === false`. Manual corrections, calibration/window/geometry changes, or cleaning-parameter drift mark applied cleaning stale with a visible refresh banner. MS-5 and exports must use `consumableCleanedObservations()` — never silently consume stale cleaning. Re-apply clears stale state.

### D6 — Duplicate container PTS

When adjacent bracket frames share identical `timeUs`, gap interpolation uses spatial blending only (`duplicate_pts_spatial_estimate` flag). Speed/outlier logic skips zero-duration pairs. Never infer elapsed time or speed from `frameIndex`.

### D7 — MS-5 event dependency

Manual hole-investigation or escape **events** require MS-5's event model. MS-4 corrects **trajectory points only**.

---

## Plan

1. Extend `types.ts`: `ManualCorrection`, `CleaningParams`, `AppliedCleaning`; extend `Track`, `AnalysisParams`.
2. Add `src/domain/trajectory/manualCorrection.ts` — apply/reset corrections by `frameIndex`.
3. Add `src/domain/trajectory/cleaning.ts` — interpolate, outlier handle, smooth; unit-tested.
4. Add `src/domain/trajectory/resolveObservations.ts` — effective observation resolver for UI/downstream.
5. Update `migration.ts`, `trialFactory.ts`, `database.ts` defaults; bump `TOOL_VERSION`.
6. Extend `sessionStore.ts` — correction + cleaning actions; preview map; clear derived layers on re-track.
7. Add `CorrectionCleaningPanel.tsx` — correction mode, cleaning params, preview/apply/discard, legend.
8. Update `VideoOverlay.tsx` — marker styles by `origin`; correction-mode cursor hint.
9. Update `ReviewView.tsx` / `VideoPlayer.tsx` — effective observations, frame index sync.
10. Add `tests/trajectory.test.ts` — correction, cleaning, duplicate-PTS independence.
11. Add `scripts/validate-ms4.mjs` — Playwright correction + cleaning flows.
12. Update `package.json` script `validate:ms4`.

---

## Validation

### Tier 1 — Automated (must pass)

| # | Criterion |
|---|---|
| V1 | Manual body correction moves displayed marker; `origin === 'manual'`. |
| V2 | Reset correction restores automatic point at that `frameIndex`. |
| V3 | Correction survives page reload. |
| V4 | Interpolation fills only gap ≤ `maxGapFrames` **and** `maxGapDurationUs`; interpolated frames have `origin: 'interpolated'` and `gap_interpolated` flag; `observed` preserved. |
| V5 | Gap longer than bounds or `absent_*` frames remain unfilled. |
| V6 | Smoothing preview differs from raw; not persisted until Apply; manual anchors preserved. |
| V7 | Discard preview leaves prior applied/raw state unchanged. |
| V8 | Two frames with identical `timeUs` accept independent corrections by `frameIndex`; duplicate PTS uses spatial estimate only. |
| V9 | Applied cleaning persists across reload when not stale. |
| V10 | Manual correction after apply marks cleaning stale; re-apply clears stale. |
| V11 | MS-1/MS-2/MS-3 regression scripts remain green. |

### Tier 2 — Manual review (scientist)

- Place body correction on a flagged frame; confirm square manual marker vs circle auto.
- Set and remove nose; confirm triangle vs no fabricated nose.
- Preview cleaning with high smoothing; confirm path changes; Discard; confirm revert.
- Apply cleaning; reload; confirm persisted cleaned markers (dashed/smoothed style).
- Edit a manual correction after apply; confirm stale banner and refresh message.
- Inspect technical details for `gap_interpolated` / `speed_outlier_replaced` flags on cleaned frames.

---

## Completion

**Status: Pending manual review** — scientific safeguards implemented; not merged.

## MS-4 scientific safeguards (2026-09-06)

Post-review at `d0208b5`, approved minimal safeguards:

### Interpolation
- Added `maxGapDurationUs` (default 500 ms) alongside `maxGapFrames`.
- Only `lost` + null body gaps between tracked brackets; never `absent_pre_trial` / `absent_in_hole`.
- Preserves `observed` and existing quality flags; `origin: 'interpolated'` + `gap_interpolated` flag.

### Smoothing
- Existing moving average unchanged; skips manual anchors, absence boundaries, flagged transitions, unsupported spans.
- UI documents that smoothing can alter path length/sharp turns; raw/corrected trajectories remain available.

### Outlier provenance
- Replaced outliers retain raw evidence via merged flags; adds `speed_outlier_replaced`. Skips zero-duration PTS pairs.

### Applied cleaning staleness
- `appliedCleaning.stale` + `staleReason` set on manual corrections, geometry/calibration/window changes, param drift.
- `consumableCleanedObservations()` for MS-5 — never silently uses stale cleaning.
- UI: `clean-stale-marker` banner; re-apply clears stale.

### Duplicate PTS
- Spatial blend only when bracket `deltaUs <= 0`; `duplicate_pts_spatial_estimate` flag. No speed inference from `frameIndex`.

### Validated
lint/test/build PASS (83 tests); `validate:ms4` PASS (~16 s) including V_stale_*; `validate:calibration`, `validate:ms1`, `validate:ms2`, `validate:ms3` PASS. Unit: `tests/trajectory.test.ts`, `tests/cleaningStaleness.test.ts`.
