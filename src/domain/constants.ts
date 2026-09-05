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

/** Tracking — blob area as fraction of π·platformRadiusPx² (validated on sample clips). */
export const TRACKING_BACKGROUND_SAMPLE_COUNT = 30;
/** ~600 px at r≈204 → ~0.0046; floor allows smaller partial blobs at rim. */
export const TRACKING_MIN_BLOB_AREA_FRACTION = 0.0015;
/** ~750 px animal vs ~3200 px start cylinder at r≈218 → reject above ~0.012. */
export const TRACKING_MAX_BLOB_AREA_FRACTION = 0.012;
/** Max centroid jump speed (px/s) before flagging speed_outlier. */
export const TRACKING_MAX_PLAUSIBLE_SPEED_PX_PER_SEC = 800;
export const TRACKING_LOW_CONFIDENCE_THRESHOLD = 0.45;
export const TRACKING_FLAGGED_FRAME_CAP = 200;
/** Recent frames for heading / disappearance heuristics. */
export const TRACKING_HEADING_HISTORY = 5;
export const TRACKING_DISAPPEARANCE_LOOKBACK = 4;
/** Rim band: fraction of platform radius where hole-proximity applies. */
export const TRACKING_RIM_BAND_FRACTION = 0.82;
/** Hole proximity: fraction of platform radius from hole center. */
export const TRACKING_HOLE_PROXIMITY_FRACTION = 0.12;
