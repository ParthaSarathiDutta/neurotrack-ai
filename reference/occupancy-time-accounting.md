# Occupancy heatmap time accounting

The occupancy heatmap accumulates **elapsed container time (seconds)** per spatial bin on the platform circle.

## Interval rule

For each consecutive in-trial observation pair `(prev → curr)` with valid body positions:

1. Skip if either observation is an unsupported tracking gap (`lost`, `absent_in_hole`, missing body).
2. Skip if `Δt ≤ 0` (duplicate container timestamps — no invented elapsed time).
3. If `prev` is **outside** the platform circle, add `Δt` to **excluded off-platform** (not binned).
4. Otherwise add `Δt` to the bin containing `prev.bodyXY`.

Weight is attributed to the interval start position; this matches time-weighted presence under piecewise-constant location between samples.

## Reconciliation

Over the observation span (first to last in-trial timestamp):

```
included_on_platform + excluded_off_platform + excluded_gaps ≈ observation_span
```

Trial window duration equals observation span when tracking covers the full window. Remaining trial time outside observation coverage is not invented.

## Example: test51

| Component | Seconds |
|-----------|---------|
| Trial duration | 44.24 |
| Included (on platform) | 33.17 |
| Excluded off-platform | 11.08 |
| Excluded gaps | 0.00 |
| Zero/duplicate Δt pairs | 17 (count) |

The ~11 s gap is expected: the tracked body was outside the platform boundary for that elapsed time.

## Display normalization

Heatmap color uses **linear mapping** from each bin's accumulated seconds to intensity, relative to the **maximum bin** (`linear_seconds_per_bin`). This is not a share-of-trial fraction.
