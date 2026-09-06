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
| RB1 | **Short-gap interpolation** fills only eligible gaps (≤ configurable frame count) between frames with body positions. |
| RB2 | **Smoothing** (moving average) is optional and parameterized; never overwrites manual corrections. |
| RB3 | **Outlier handling** flags/replaces implausible jumps using container `timeUs` deltas and configurable speed multiplier. |
| RB4 | Long gaps, `absent_pre_trial`, and unsupported spans are **not** silently filled. |
| RB5 | **Nose is never interpolated or smoothed** — body only. |
| RB6 | Cleaning parameters are **visible, editable**, and stored with applied results. |
| RB7 | User **previews** cleaned trajectory before **Apply**; **Discard** leaves prior state unchanged. |
| RB8 | Applied cleaning stored separately in `track.appliedCleaning`; raw + manual layers preserved. |
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
- `smoothingWindow: 3` — odd-length moving average on body only.
- `outlierSpeedMultiplier: 2.0` — relative to tracking `maxPlausibleSpeedPxPerSec`.

### D4 — Provenance is never silent

`origin` on every displayed point reflects how coordinates were produced. Quality metrics remain computed from **raw** MS-3 output; cleaning does not rewrite `track.quality`.

### D5 — MS-5 event dependency

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
| V4 | Interpolation fills only gap ≤ `maxGapFrames`; interpolated frames have `origin: 'interpolated'`. |
| V5 | Gap longer than `maxGapFrames` remains unfilled. |
| V6 | Smoothing preview differs from raw; not persisted until Apply. |
| V7 | Discard preview leaves prior applied/raw state unchanged. |
| V8 | Two frames with identical `timeUs` accept independent corrections by `frameIndex`. |
| V9 | MS-1/MS-2/MS-3 regression scripts remain green. |

### Tier 2 — Manual review (scientist)

- Place body correction on a flagged frame; confirm square manual marker vs circle auto.
- Set and remove nose; confirm triangle vs no fabricated nose.
- Preview cleaning with high smoothing; confirm path changes; Discard; confirm revert.
- Apply cleaning; reload; confirm persisted cleaned markers (dashed/smoothed style).

---

## Completion

**Status: Pending manual review** — not merged.
