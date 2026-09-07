# UI corrections log

Technical record of usability fixes in the Correction & cleaning UI. Each entry describes the defect, intended behavior, implementation, and validation.

---

## One-click nose removal (2026-09-07)

### Problem

In Correction & cleaning, **Remove nose** (`removeManualNoseCorrection`) required an existing manual correction with `bodyXY`. On frames that only had an automatic nose estimate, clicking the control returned *"No manual nose to remove on this frame."* Users had to place a body correction first, then remove the nose — an unnecessary two-step workaround.

### Expected behavior

On any frame with a visible nose estimate (automatic or manual):

1. User clicks **Mark nose unavailable** (formerly **Remove nose**).
2. A manual correction is created or updated that preserves the effective body (manual body if present, otherwise raw automatic body), sets `noseXY` to `null`, leaves raw observations unchanged, records manual provenance and timestamp, marks applied cleaning stale, persists, and triggers event re-detection through the existing correction workflow.
3. **Reset frame to auto** restores the original automatic nose estimate.

Removing a nose means marking its position unavailable for analysis on that frame — not deleting the mouse, the frame, or body tracking.

### Fix

- **`src/domain/trajectory/manualCorrection.ts`**: Added `effectiveNoseXY`, `canRemoveNoseEstimate`, and `resolveNoseRemoval` to centralize removable-nose logic and build the correction payload without requiring a pre-existing manual body entry.
- **`src/store/sessionStore.ts`**: `removeManualNoseCorrection` now uses `resolveNoseRemoval`, accepts automatic-only frames, calls `scheduleAsyncRedetect` on success, and returns clear status messages for no-op cases.
- **`src/components/CorrectionCleaningPanel.tsx`**: Button label **Mark nose unavailable**; enabled only when a removable nose exists; helper text explains the action and points users to **Reset frame to auto** for restoration.

### Validation

- Unit tests in `tests/noseRemovalCorrection.test.ts`:
  - One-click removal on automatic-only frames
  - Preservation of manual body when removing manual nose
  - Clear no-op / already-removed feedback
  - Reset restores automatic nose; raw observations remain immutable
  - Applied cleaning marked stale
  - Session persistence round-trip
  - Confirmed reviewed events preserved through merge during re-detect
- `npm test`, `npm run lint`, `npm run build`
