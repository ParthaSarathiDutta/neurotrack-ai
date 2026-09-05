/** Standard 20-hole Barnes maze — Salk task assay contract. Not user-configurable. */
export const HOLE_COUNT = 20;
export const HOLE_SPACING_DEG = 360 / HOLE_COUNT;
export const DEFAULT_CUTOFF_SECONDS = 180;

/** Motion-onset detection defaults. */
export const MOTION_FLOOR_MULTIPLIER = 3;
export const MOTION_MIN_CONSECUTIVE_FRAMES = 3;
export const MOTION_NOISE_SAMPLE_FRAMES = 30;
export const MOTION_PIXEL_THRESHOLD = 8;
/** Pre-trial frozen segment — noise samples taken from times before this (µs). */
export const MOTION_QUIET_END_US = 4_000_000;
export const MOTION_SCAN_START_US = 3_000_000;
export const MOTION_SCAN_END_US = 7_000_000;
/** Earliest plausible trial onset — all sample clips are frozen until ~5 s (constitution). */
export const MOTION_EARLIEST_ONSET_US = 4_500_000;
export const MOTION_EXPECTED_ONSET_US = 5_000_000;

/** Template cross-rig discrepancy tolerance (fraction of rough platform radius). */
export const TEMPLATE_DISCREPANCY_TOLERANCE = 0.08;

/** Calibration candidate extraction. */
export const MIN_HOLE_CANDIDATES = 10;
export const MAX_HOLE_CANDIDATES = 30;

/**
 * Geometric quality thresholds derived from constitution empirical ring fits
 * (≤2.1 px max residual on sample clips). High confidence requires near-ideal alignment.
 */
export const MAX_CIRCLE_FIT_RESIDUAL_PX = 3;
export const MAX_SLOT_RESIDUAL_HIGH_PX = 5;
export const MAX_SLOT_MEDIAN_RESIDUAL_HIGH_PX = 2.5;
export const MAX_SLOT_RESIDUAL_LOW_PX = 7;
export const MAX_SLOT_MEDIAN_RESIDUAL_LOW_PX = 4;
export const MIN_DETECTED_HOLES_HIGH = 20;
export const MIN_DETECTED_HOLES_LOW = 16;
