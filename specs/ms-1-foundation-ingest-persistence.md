# MS-1 — Foundation, Ingest & Persistence

Branch: `ms-1-foundation-ingest-persistence`  
Constitution reference: `specs/constitution.md` → MS-1

## Requirements

| # | Requirement |
|---|---|
| R1 | Vite + React + TypeScript application scaffold with MIT license. |
| R2 | GitHub Actions: lint, unit tests, production build, GitHub Pages deployment config. |
| R3 | Accessibility baseline: keyboard-reachable controls, labeled inputs, visible focus, contrast-safe design tokens, layout usable at 200% zoom. |
| R4 | Drag-and-drop multi-video loading and folder selection (`webkitdirectory` fallback). |
| R5 | Ingest via validated WebCodecs `VideoDecoder` + `mp4box.js` in a dedicated Worker — no per-filename logic, no assumed frame rate. |
| R6 | Per-video metadata and a presentation-timestamp index: each row carries container-derived `timeUs` (authoritative for timing) and a unique presentation-order `frameIndex` (authoritative for identity). |
| R7 | Dexie/IndexedDB persistence for trials, analysis parameters, geometry/track/event/measure placeholders, and ingest progress — autosaved. |
| R8 | Content-fingerprint video identity with bounded blob cache; reselecting an evicted file re-associates the same trial without losing analysis state. |
| R9 | No backend, no data egress, no sample `.mp4` files in the repository. |

## Decisions

- **D1 — Reuse Phase 0 decode architecture.** Worker demuxes with `mp4box.js`, configures `VideoDecoder` from dynamic `avcC` extraction (`src/workers/mp4-utils.ts`), and builds the timestamp index from sample `cts` converted to `timeUs`. Decoder runs to completion to verify frame counts; frames are closed immediately (index + metadata only, no pixel retention).
- **D2 — Container timing vs frame identity.** `timeUs` comes from sample `cts / timescale` and is the authoritative presentation time for all scientific timing (deltas, trial-window boundaries, measures). It is **not** guaranteed unique — distinct frames may share the same container timestamp. **`frameIndex`** is the unique presentation-order identity for a frame, observation, correction, or lookup. Never synthesize scientific timing from `frameIndex` or an assumed FPS. Ingest validation compares container timescale and tick deltas, never literal `15` or `30` fps constants.
- **D3 — Fingerprint = SHA-256 of file bytes.** Trials are keyed by fingerprint; display name is editable independently.
- **D4 — Bounded blob cache in Dexie.** Default budget 50 MB, LRU eviction by `lastAccessedAt`. Trial records persist independently of cached blobs.
- **D5 — Zustand + debounced Dexie writes** for session state; hydrate from IndexedDB on startup.
- **D6 — GitHub Pages base path** via `VITE_BASE_PATH` at build time (defaults to `/` for local dev).

## Plan

1. Scaffold Vite/React/TS, ESLint, Vitest, design tokens, and app shell.
2. Port and productionize `mp4-utils.ts` and ingest Worker from Phase 0 spike.
3. Implement domain types matching constitution data contracts (placeholders for MS-2+ fields).
4. Implement Dexie schema, video cache, persistence layer, and autosave hook.
5. Build ingest UI: drop zone, folder picker, trial list, metadata/timestamp summary, cache-eviction reselect flow.
6. Add unit tests for timing, fingerprint, persistence, and cache behavior.
7. Add GitHub Actions workflow and MS-1 validation script (Playwright + three local videos).

## Validation

| # | Criterion | Pass condition |
|---|---|---|
| V1 | Build & deploy config | `npm run lint`, `npm test`, and `npm run build` succeed; Pages workflow present. |
| V2 | Three-video ingest | `test50`, `test51`, `test53` load and index without file-specific branches. |
| V3 | test51 timing | Track timescale 15000; median unique-cts interval = 1001/15000 s (not 15 fps). |
| V4 | Timestamp source | Index entries trace to container `cts/timescale`; no fps literals in timing path. |
| V5 | Persistence | Trial list and metadata survive page refresh. |
| V6 | Cache re-association | After forced cache eviction, reselecting the same file restores the same trial record. |
| V7 | Accessibility | Controls labeled; keyboard tab order reaches ingest actions; 200% zoom does not clip primary UI. |

## Completion

**Status: Complete** (merged to `main`, September 5, 2026)

| # | Result | Evidence |
|---|---|---|
| V1 | PASS | `npm run lint`, `npm test`, `npm run build`; `.github/workflows/ci.yml` |
| V2 | PASS | `npm run validate:ms1` — all three clips ingest without per-file logic |
| V3 | PASS | test51 container frame rate `15000/1001`, timescale `15000` |
| V4 | PASS | Timestamp index from `cts/timescale`; no fps literals in timing path |
| V5 | PASS | Trial list survives page refresh |
| V6 | PASS | Cache eviction + reselect preserves trial label and metadata |
| V7 | PASS | Keyboard-reachable upload/trials; Technical details disclosure; selected state uses text marker + border (not color alone) |

Final UI refinement: user-facing subtitle "Barnes maze video analysis"; trial summary vs collapsible Technical details; no milestone terminology in UI.
