# Occupancy heatmap display normalization

The occupancy heatmap accumulates **true seconds per bin** from on-platform trajectory intervals. Color shading applies a **display-only** normalization so skewed bin distributions remain readable.

## Bin weights (unchanged)

- Each grid cell stores the sum of valid Δt intervals whose body position starts in that cell.
- Tooltips, accounting panel totals, and legend tick labels always report **true accumulated seconds**.
- Display normalization never alters stored weights, binning, or MS-6 occupancy accounting.

## When sqrt display is selected

`resolveOccupancyDisplayNormalization()` chooses `sqrt_seconds_per_bin` when:

1. `max bin seconds / median(nonzero bin seconds) ≥ 4`, and
2. at most four bins hold ≥ half of the maximum bin weight, and
3. at least eight nonzero bins exist.

This pattern appears on sample trials **test51** and **test53**, where a few central bins dominate and most bins are faint under a linear color map.

## Mappings

| Mode | Display intensity from bin weight `w`, max `m` |
|------|--------------------------------------------------|
| `linear_seconds_per_bin` | `w / m` |
| `sqrt_seconds_per_bin` | `√(w / m)` |

The color legend gradient uses the same mapping as the cells. Tick labels remain **0 s**, **max/2 s**, and **max s** (true seconds). Nonlinear mappings are disclosed in the figure’s “Color scale details” control.

## Color ramp

Sequential blue ramp tuned for grayscale and deuteranopia readability. Relative luminance separation is regression-tested in `tests/ms6-visualization-readability.test.ts`.
