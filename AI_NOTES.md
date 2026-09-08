# AI Notes

Concise summary for submission. Full milestone-by-milestone engineering log: `reference/ai-notes-archive.md`.

## Tools and setup

- **Primary environment:** [Cursor](https://cursor.com) IDE with Agent mode (Composer), used for implementation, refactors, validation scripts, and documentation across MS-1–MS-6.
- **Project guidance:** `.cursor/rules/project.mdc` (Salk Task 1 scope, scientific integrity, no sample-video hard-coding). Specs in `specs/` and `reference/` were treated as authoritative over agent suggestions.
- **Validation:** Vitest unit tests, ESLint, Playwright browser validators (`scripts/validate-*.mjs`), and GitHub Actions CI (lint → test → build → Pages deploy).
- **No committed `CLAUDE.md` or custom MCP server** for this repo — configuration is the Cursor rules above plus the archived notes.

Model selection varied by session (Cursor Agent default / user-selected models). I did not pin a single model ID for the whole project; decisions were validated by tests and browser scripts, not by model self-report.

## Three disagreements / catches

### 1. test51 ring-fit center (MS-2)

**Wrong:** An early agent refined the hole-ring center by averaging matched candidate positions. On a circle, the centroid pulls toward the arc — test51’s center shifted ~20 px while residuals looked plausible.

**Tell:** Manual overlay review: hole markers systematically offset despite “high” confidence.

**Fix:** Geometric circle-fit refinement (`ringFit.ts`), never centroid-averaging; confidence from slot residuals. Validated with `npm run validate:calibration` and multi-trial MS-2 isolation tests (V19).

### 2. Frame decode order and timestamp integrity (MS-2 / MS-3)

**Wrong:** Sorting H.264 samples by presentation timestamp before `VideoDecoder` corrupted B-frame GOP output (test51 trial-start shifted ~5.07 s → ~5.205 s; false motion from multi-second gaps in trial-window sampling).

**Tell:** Offline validation harness disagreed with live UI; bisect tied the shift to decode-order fix `8eb266b`. Duplicate container timestamps displayed as identical seconds at 3-decimal formatting.

**Fix:** Feed decoder in decode order; single contiguous trial-window sample timeline; 6-decimal time display; duplicate-CTS rank matching in `frame-worker.ts`. Validated with `validate:ms2`, `tests/timestampIntegrity.test.ts`, and shared `mp4TimestampIndex.mjs` for offline scripts.

### 3. One-click nose removal (MS-4)

**Wrong:** “Mark nose unavailable” required a prior body correction because `removeManualNoseCorrection` only cleared an existing manual nose entry.

**Tell:** UI smoke test — button no-op on automatic-only frames; scientist workflow blocked.

**Fix:** `ManualCorrection.noseRemoved` flag, `resolveCorrectedNoseXY()` precedence, one-click removal + downstream re-detect on body/nose/reset actions. Validated with `tests/noseRemovalCorrection.test.ts` (20+ cases) and `npm run validate:nose-correction-smoke`.

## What was checked before trusting the result

- **Unit tests** (230) for domain logic: calibration, tracking, cleaning, events, exports, visualization layout.
- **Playwright validators** per milestone on real sample clips (test50/51/53) — not synthetic-only UI tests.
- **Manual browser review** at MS-2/4/5/6 sign-offs (calibration overlays, correction provenance, escape confirmation semantics, figure readability).
- **Output integrity** — `validate:ms6-outputs` checks CSV/XLSX sheets, censored vs numeric latency, unavailable-vs-zero error counts, and on-disk XLSX formatting.
- **Production smoke** — `validate:deploy` against GitHub Pages after each main deploy.
- **Scientific guardrails** — proposed vs confirmed events, censored latencies, unknown target/scale, and diagnostic vs gated speed columns were explicitly tested rather than assumed from agent output.
