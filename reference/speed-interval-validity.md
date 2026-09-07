# Speed interval validity (speed_interval_validity.v1)

NeuroTrack applies this policy to **mean speed** and **max speed** only. Path length, event detection, body-entry rules, and other measures are unchanged.

## Problem

Container timestamps occasionally compress between consecutive frames (Δt far below the recording's typical frame spacing). Under MS-5 D12, any Δt > 0 yields a finite instantaneous speed. A small spatial displacement divided by a microsecond-scale Δt produces a non-physical speed spike that must not be reported as the scientific maximum.

## Policy

**Reference interval τ:** median positive Δt between consecutive in-trial observations (container timestamps). If unavailable, median positive Δt from the in-trial container timestamp index.

**Quality-valid speed interval:** consecutive observation pair with valid body positions (not `lost`, not `absent_in_hole`), Δt > 0, and:

```
Δt ≥ 0.05 × τ
```

The factor `0.05` is **relative to the recording's own spacing**, not a universal millisecond cutoff.

**Excluded intervals:** remain in path-length sums (D12 duplicate-PTS rule). Elapsed time is never invented or replaced with FPS-derived estimates.

## Reported measures

| Measure | Definition ID | Role |
|---------|---------------|------|
| Mean speed | `mean_speed.v2` | Time-weighted mean over quality-valid intervals |
| Max speed | `max_speed.v2` | Max over quality-valid intervals |
| Mean speed (diagnostic) | `mean_speed_diagnostic.v1` | Unfiltered D12 mean — not for primary reporting |
| Max speed (diagnostic) | `max_speed_diagnostic.v1` | Unfiltered D12 max — not for primary reporting |

When no quality-valid intervals exist, gated mean/max speed are **unavailable** (not zero).

## Provenance

Stored measure snapshots from bundles or prior sessions are **not silently rewritten**. Recompute measures from events (explicit user action) applies v2 definitions while preserving events, track, and corrections.

Export columns include `definitionId`, `definitionVersion`, `flags`, and `assumptions` with exclusion counts (`excluded_timestamp_compression`, `quality_gated_intervals`, policy summary).

## Example (test53)

Frames 811→812: Δt = 65 µs vs median ≈ 33 333 µs. Interval excluded; unfiltered max ≈ 44 163 px/s retained as diagnostic only.
