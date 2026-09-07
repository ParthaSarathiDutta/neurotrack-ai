# NeuroTrack AI — demonstration checklist

Technical walkthrough for evaluators. Uses committed example analysis and documented sample outcomes — do not reclassify uncertain events or invent measurements for presentation.

**Live app:** https://parthasarathidutta.github.io/neurotrack-ai/  
**Demo video:** *(record and add URL to README before email submission)*

---

## 1. Load example analysis (no video required)

1. Open the live URL in a fresh browser profile (or incognito).
2. Confirm empty session: **Load example analysis** is visible.
3. Click **Load example analysis** → three trials appear (test50, test51, test53).
4. No tracking or event-detection runs should start automatically.

**Expected saved outcomes (from `outputs/README.md`):**

| Clip | Escape / latency | Notes |
|------|------------------|-------|
| test53 | Confirmed completion — **24.40 s** numeric total latency | Protocol target still **unknown**; completion is candidate-hole confirmed |
| test51 | Candidate entry uncertain — **censored** ≥ 44.24 s | Not protocol-target escape |
| test50 | Incomplete censored — **censored** ≥ 180.03 s | Recording ends mid-entry |

All three: **protocol target unknown**, **px/cm unknown** → primary latency, errors, and quadrant measures show **Unavailable**, not zero.

---

## 2. Inspect results report (test53)

1. Select **test53**.
2. Open **Results & export** panel.
3. Point out:
   - Total latency **24.40 s** (confirmed escape)
   - Primary latency / errors / quadrants **Unavailable** (target not confirmed)
   - Path length and speeds in **px** (scale unknown)
   - Mean/max speed use **v2** gating policy; diagnostic speeds retained separately
   - Escape state copy distinguishes candidate-hole completion from protocol-target escape

Repeat briefly for test51 (censored) and test50 (censored incomplete).

---

## 3. Full pipeline with local video (optional second segment)

Requires sample MP4s from [Salk sample data](https://github.com/talmolab/salk-airc-takehome/tree/main/data/barnes-maze) in `data/barnes-maze/`.

1. **Ingest** — drag/drop or folder import.
2. **Calibration** — auto 20-hole detection; confirm or nudge; note low-confidence acknowledgment on test51.
3. **Trial window** — motion onset ~5 s; confirm window.
4. **Tracking** — run with progress; quality summary.
5. **Corrections / cleaning** — manual body/nose edit; preview/apply cleaning; show provenance markers.
6. **Events** — run detection; review proposed vs confirmed; confirm test53 escape if demonstrating review workflow.

Do not silently overwrite the committed example analysis during the demo unless intentional.

---

## 4. Visualizations (test53 from example)

1. Open **Visualizations** panel.
2. **Trajectory overlay** on review player — basis-aware, provenance styling, toggle.
3. **Hole-visit timeline** — holes 1–20, investigation spans, escape/censor markers.
4. **Occupancy heatmap** — time-weighted; legend shows seconds; sqrt display normalization when distribution is skewed.

Charts render without MP4 bytes; relink video for frame-accurate scrubbing.

---

## 5. Export and spreadsheet inspection

1. **Download CSV** and **Download XLSX** (session or per-trial).
2. Open XLSX in Excel/Numbers:
   - **Results** — human-readable headers, styled headers, frozen row
   - **Summary** — machine-readable `valueKind` columns (~152 columns)
   - **Events** — frame convention note, 0-based internal + 1-based display columns
   - **Parameters**, **OperationalDefinitions**, **Provenance**

Compare with committed files in `outputs/test53_report.xlsx`.

---

## 6. Bundle export / import / video relink

1. **Export analysis bundle** (`.neurotrack.json`).
2. Reset session or use fresh browser tab.
3. **Import bundle** — measures and events restore without re-tracking.
4. Re-select matching MP4 when prompted (fingerprint relink).
5. Show import collision dialog if importing over existing session.

---

## 7. Limitations and reproducibility (closing)

Cover honestly:

- Target hole and scale unknown on sample clips → unavailable target-dependent measures
- Heuristic search strategy ≠ any single published classifier
- Body-entry Path A vs Path B semantics (see `reference/neurotrack-body-entry-v3.md`)
- Speed v2 gating vs diagnostic ungated speeds (`reference/speed-interval-validity.md`)
- No cohort metadata / learning curves in MVP
- Bundle size grows with observation count; video bytes never embedded

**Reproducibility:**

```bash
npm run generate:ms6-outputs
npm run validate:ms6-outputs
npm run validate:deploy   # production smoke test
```

Committed outputs: `outputs/` + `outputs/README.md`.
