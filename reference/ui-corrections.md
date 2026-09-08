# UI corrections log

Technical record of usability fixes in the Correction & cleaning UI. Each entry describes the defect, intended behavior, implementation, and validation.

---

## One-click nose removal and body/nose workflow (2026-09-07)

### Original issue

In Correction & cleaning, **Remove nose** required an existing manual correction with `bodyXY`. On frames that only had an automatic nose estimate, clicking the control returned *"No manual nose to remove on this frame."* Users had to place a body correction first, then remove the nose.

### Related pre-existing quirks (resolved in same branch)

1. **Body-only correction hid automatic nose.** `applyManualBodyCorrection` stored `noseXY: null` when no manual nose existed, and `applyManualCorrections` treated that as an explicit null override — hiding a valid automatic nose.
2. **Reset frame to auto did not update downstream analysis.** `resetManualCorrection` persisted the reset and marked cleaning stale but did not call `scheduleAsyncRedetect`, unlike body correction and nose removal.
3. **Manual nose placement did not update downstream analysis.** `applyManualNoseCorrection` persisted the correction and marked cleaning stale but did not call `scheduleAsyncRedetect`.

### Expected behavior

**Mark nose unavailable (one click)**

On any frame with a visible nose estimate (automatic or manual):

1. User clicks **Mark nose unavailable**.
2. A manual correction is created or updated that preserves the effective body, sets explicit nose removal, leaves raw observations unchanged, records manual provenance and timestamp, marks applied cleaning stale, persists, and triggers event re-detection.
3. **Reset frame to auto** restores the original automatic body and nose and triggers the same downstream update workflow.

**Correct body (body-only)**

- Changes only the body position.
- Preserves an existing manual nose or automatic nose when available.
- Does not restore a nose that was explicitly marked unavailable (`noseRemoved: true`).

**Correct nose (manual placement)**

- Requires a body position (automatic or manual) on the frame.
- Sets `noseXY` to the placed point and clears `noseRemoved`.
- Preserves the effective body unchanged.
- Marks cleaning stale, persists, and triggers event re-detection (same workflow as body correction, nose removal, and reset).

Removing a nose means marking its position unavailable for analysis on that frame — not deleting the mouse, the frame, or body tracking.

### Fix

**Representation (`ManualCorrection`)**

- Added optional `noseRemoved?: boolean`.
- `noseRemoved: true` — nose explicitly unavailable.
- Manual nose point in `noseXY` — corrected nose position.
- Body-only correction — `noseRemoved` false/undefined; effective nose inherited from raw via `resolveCorrectedNoseXY`.
- Legacy bundles without `noseRemoved`: infer intent from whether `bodyXY` matches raw (unchanged body + null nose → explicit removal; changed body + null nose → inherit automatic nose).

**Domain (`src/domain/trajectory/manualCorrection.ts`)**

- `resolveCorrectedNoseXY`, `isNoseExplicitlyRemoved`, `buildBodyCorrection`, `buildManualNoseCorrection`, `resolveNoseRemoval` (sets `noseRemoved: true`).

**Store (`src/store/sessionStore.ts`)**

- Body/nose/remove/reset actions use builders and call `scheduleAsyncRedetect` on successful correction changes.
- Re-detect is skipped when nose placement cannot proceed (no body on frame).

**UI (`src/components/CorrectionCleaningPanel.tsx`)**

- **Mark nose unavailable** enabled when a removable nose exists; helper text uses `isNoseExplicitlyRemoved`.

**Test hooks**

- Added `__ntGetRawNoseAt`, `__ntGetEffectiveNoseAt`, `__ntFindFrameWithAutoNose`, `__ntGetManualCorrectionMeta`, etc. for browser smoke validation.

### Validation

**Unit / regression (`tests/noseRemovalCorrection.test.ts`)**

- Body-only preserves automatic and manual nose.
- Body correction after explicit removal does not restore nose.
- Legacy bundle compatibility heuristics.
- One-click removal, manual nose placement after removal, reset, cleaning staleness, persistence, bundle round-trip.
- Confirmed event preservation through merge.

**Legacy limitation (not migrated)**

Bundles saved before `noseRemoved` was introduced may contain ambiguous records when a scientist removed the nose **after** also correcting the body on the same frame. Those records stored `noseXY: null` without `noseRemoved: true`. On load, the legacy heuristic treats unchanged-body + null nose as explicit removal and changed-body + null nose as body-only (inherit automatic nose). A true explicit removal that changed only the nose flag while the stored body differed from raw may be misclassified until the frame is re-saved through **Mark nose unavailable** (which writes `noseRemoved: true`). No automatic rewrite of saved bundles is performed.

**Automated suites**

- `npm test` — full unit suite.
- `npm run lint`
- `npm run build`
- `npm run validate:ms4`
- `npm run validate:nose-correction-smoke` — isolated Playwright session on `test53.mp4`.
- `npm run validate:ms5` — event/measures regression (downstream correction workflow).

**Manual browser smoke (validate:nose-correction-smoke)**

Isolated Playwright browser (not the user's regular browser IndexedDB):

1. Fresh session → ingest `test53` → track.
2. Frame with automatic nose → **Mark nose unavailable** without body correction first.
3. Nose hidden, body unchanged, `noseRemoved: true` saved.
4. Body-only correction → nose remains unavailable.
5. **Reset frame to auto** → automatic nose and body restored; re-detect invoked.
6. Reload → explicit removal persists.
7. Downstream events/measures updated through established re-detect workflow.

Results from local run (all `PASS`):

| Check | Description |
|-------|-------------|
| S1 | Frame with automatic nose found on test53 |
| S2 | Mark nose unavailable enabled on target frame |
| S3 | One-click removal hides nose, preserves body, saves `noseRemoved: true` |
| S4 | Body-only correction after removal keeps nose unavailable |
| S4b | Event detection completes |
| S5 | Reset frame to auto restores automatic body and nose |
| S6 | Reset triggers downstream re-detect (`events.computedAt` updates) |
| S7 | Explicit removal survives reload |
| S8 | Downstream events/measures remain consistent after workflow |
