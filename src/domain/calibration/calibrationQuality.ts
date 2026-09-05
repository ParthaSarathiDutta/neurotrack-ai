import {
  MIN_DETECTED_HOLES_HIGH,
  MIN_DETECTED_HOLES_LOW,
  MAX_CIRCLE_FIT_RESIDUAL_PX,
  MAX_SLOT_MEDIAN_RESIDUAL_HIGH_PX,
  MAX_SLOT_MEDIAN_RESIDUAL_LOW_PX,
  MAX_SLOT_RESIDUAL_HIGH_PX,
  MAX_SLOT_RESIDUAL_LOW_PX,
} from '../constants';
import type { CalibrationConfidence } from '../types';
import type { RingFitResult } from './ringFit';

export interface CalibrationQuality {
  confidence: CalibrationConfidence;
  maxSlotResidualPx: number;
  medianSlotResidualPx: number;
  rmsSlotResidualPx: number;
  detectedCount: number;
  modeledCount: number;
  circleFitResidualPx: number;
  reasons: string[];
}

/** Assess automatic calibration trustworthiness from geometric residuals. */
export function assessCalibrationQuality(
  ring: RingFitResult,
  circleFitResidualPx: number,
): CalibrationQuality {
  const reasons: string[] = [];
  const slotResiduals = ring.slotResidualsPx.filter((r) => Number.isFinite(r));
  const detectedResiduals = ring.holes
    .filter((h) => h.source === 'detected')
    .map((h) => ring.slotResidualsPx[h.id] ?? 0);

  const maxSlot = slotResiduals.length ? Math.max(...slotResiduals) : Infinity;
  const medianSlot = median(detectedResiduals.length ? detectedResiduals : slotResiduals);
  const rmsSlot = rms(detectedResiduals.length ? detectedResiduals : slotResiduals);

  if (ring.detectedCount < MIN_DETECTED_HOLES_LOW) {
    reasons.push(
      `Only ${ring.detectedCount} holes directly detected (need ≥${MIN_DETECTED_HOLES_LOW}).`,
    );
  }
  if (circleFitResidualPx > MAX_CIRCLE_FIT_RESIDUAL_PX) {
    reasons.push(
      `Candidate circle-fit residual ${circleFitResidualPx.toFixed(1)} px exceeds ${MAX_CIRCLE_FIT_RESIDUAL_PX} px.`,
    );
  }
  if (maxSlot > MAX_SLOT_RESIDUAL_LOW_PX) {
    reasons.push(`Worst hole alignment ${maxSlot.toFixed(1)} px from expected slot.`);
  }
  if (medianSlot > MAX_SLOT_MEDIAN_RESIDUAL_LOW_PX) {
    reasons.push(`Median hole alignment ${medianSlot.toFixed(1)} px exceeds limit.`);
  }

  let confidence: CalibrationConfidence = 'high';
  if (
    ring.detectedCount < MIN_DETECTED_HOLES_LOW ||
    circleFitResidualPx > MAX_CIRCLE_FIT_RESIDUAL_PX ||
    maxSlot > MAX_SLOT_RESIDUAL_LOW_PX ||
    medianSlot > MAX_SLOT_MEDIAN_RESIDUAL_LOW_PX
  ) {
    confidence = 'failed';
  } else if (
    ring.detectedCount < MIN_DETECTED_HOLES_HIGH ||
    maxSlot > MAX_SLOT_RESIDUAL_HIGH_PX ||
    medianSlot > MAX_SLOT_MEDIAN_RESIDUAL_HIGH_PX
  ) {
    confidence = 'low';
    if (ring.detectedCount < MIN_DETECTED_HOLES_HIGH) {
      reasons.push(
        `${ring.modelCount} holes are modeled (not detected) — review before confirming.`,
      );
    }
  }

  return {
    confidence,
    maxSlotResidualPx: maxSlot,
    medianSlotResidualPx: medianSlot,
    rmsSlotResidualPx: rmsSlot,
    detectedCount: ring.detectedCount,
    modeledCount: ring.modelCount,
    circleFitResidualPx,
    reasons,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function rms(values: number[]): number {
  if (values.length === 0) return Infinity;
  return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
}
