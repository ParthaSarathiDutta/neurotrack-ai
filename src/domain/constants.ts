/** Standard 20-hole Barnes maze — Salk task assay contract. Not user-configurable. */
export const HOLE_COUNT = 20;
export const HOLE_SPACING_DEG = 360 / HOLE_COUNT;
export const DEFAULT_CUTOFF_SECONDS = 180;

/** Motion-onset detection defaults. */
export const MOTION_FLOOR_MULTIPLIER = 3;
export const MOTION_MIN_CONSECUTIVE_FRAMES = 3;
export const MOTION_NOISE_SAMPLE_FRAMES = 30;

/** Template cross-rig discrepancy tolerance (fraction of rough platform radius). */
export const TEMPLATE_DISCREPANCY_TOLERANCE = 0.08;

/** Calibration acceptance thresholds. */
export const MIN_HOLE_CANDIDATES = 10;
export const MAX_HOLE_CANDIDATES = 30;
export const MAX_RING_FIT_RESIDUAL_PX = 25;
