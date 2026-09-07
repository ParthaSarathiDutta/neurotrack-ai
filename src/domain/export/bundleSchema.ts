import type { AnalysisParams, MeasurementBasis, TrialRecord } from '../types';

export const BUNDLE_SCHEMA_VERSION = '1.0.0';
export const BUNDLE_TYPE = 'neurotrack-analysis';

export interface BundleVideoIdentity {
  fingerprint: string;
  fileName: string;
  durationSec: number | null;
  nbSamples: number | null;
  containerFrameRateLabel: string | null;
}

export interface BundleExportProvenance {
  measurementBasis: MeasurementBasis;
  eventReviewCounts: {
    proposed: number;
    confirmed: number;
    rejected: number;
    manual: number;
  };
  escapeState: string | null;
  cleaningStale: boolean;
  eventsStale: boolean;
}

export interface BundleTrialEntry {
  trial: TrialRecord;
  videoIdentity: BundleVideoIdentity;
  exportProvenance: BundleExportProvenance;
}

export interface NeuroTrackBundle {
  schemaVersion: typeof BUNDLE_SCHEMA_VERSION;
  bundleType: typeof BUNDLE_TYPE;
  exportedAt: string;
  toolVersion: string;
  analysisParams: AnalysisParams;
  selectedTrialId: string | null;
  trials: BundleTrialEntry[];
}

export interface BundleValidationError {
  path: string;
  message: string;
}

export type SupportedSchemaVersion = typeof BUNDLE_SCHEMA_VERSION;

export function isSupportedSchemaVersion(version: unknown): version is SupportedSchemaVersion {
  return version === BUNDLE_SCHEMA_VERSION;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function pushError(errors: BundleValidationError[], path: string, message: string): void {
  errors.push({ path, message });
}

export function validateNeuroTrackBundle(raw: unknown): {
  ok: true;
  bundle: NeuroTrackBundle;
} | {
  ok: false;
  errors: BundleValidationError[];
} {
  const errors: BundleValidationError[] = [];

  if (!isObject(raw)) {
    return { ok: false, errors: [{ path: '$', message: 'Bundle must be a JSON object.' }] };
  }

  if (raw.bundleType !== BUNDLE_TYPE) {
    pushError(errors, 'bundleType', `Expected "${BUNDLE_TYPE}".`);
  }

  if (!isSupportedSchemaVersion(raw.schemaVersion)) {
    pushError(
      errors,
      'schemaVersion',
      `Unsupported schema version: ${String(raw.schemaVersion)}. Supported: ${BUNDLE_SCHEMA_VERSION}.`,
    );
  }

  if (typeof raw.exportedAt !== 'string' || !raw.exportedAt) {
    pushError(errors, 'exportedAt', 'exportedAt must be a non-empty ISO-8601 string.');
  }

  if (typeof raw.toolVersion !== 'string' || !raw.toolVersion) {
    pushError(errors, 'toolVersion', 'toolVersion is required.');
  }

  if (!isObject(raw.analysisParams)) {
    pushError(errors, 'analysisParams', 'analysisParams object is required.');
  }

  if (!Array.isArray(raw.trials) || raw.trials.length === 0) {
    pushError(errors, 'trials', 'trials must be a non-empty array.');
  }

  if (raw.selectedTrialId != null && typeof raw.selectedTrialId !== 'string') {
    pushError(errors, 'selectedTrialId', 'selectedTrialId must be a string or null.');
  }

  if (errors.length) return { ok: false, errors };

  const trialsArr = raw.trials as unknown[];
  for (let i = 0; i < trialsArr.length; i += 1) {
    const entry = trialsArr[i];
    const prefix = `trials[${i}]`;
    if (!isObject(entry)) {
      pushError(errors, prefix, 'Trial entry must be an object.');
      continue;
    }
    if (!isObject(entry.trial)) {
      pushError(errors, `${prefix}.trial`, 'trial object is required.');
      continue;
    }
    const trial = entry.trial as Record<string, unknown>;
    if (typeof trial.id !== 'string' || !trial.id) {
      pushError(errors, `${prefix}.trial.id`, 'trial.id is required.');
    }
    if (typeof trial.fingerprint !== 'string' || !trial.fingerprint) {
      pushError(errors, `${prefix}.trial.fingerprint`, 'trial.fingerprint is required.');
    }
    if (typeof trial.fileName !== 'string') {
      pushError(errors, `${prefix}.trial.fileName`, 'trial.fileName is required.');
    }
    if (!Array.isArray(trial.timestampIndex)) {
      pushError(errors, `${prefix}.trial.timestampIndex`, 'trial.timestampIndex array is required.');
    }
    if (!isObject(entry.videoIdentity)) {
      pushError(errors, `${prefix}.videoIdentity`, 'videoIdentity is required.');
    } else if (entry.videoIdentity.fingerprint !== trial.fingerprint) {
      pushError(
        errors,
        `${prefix}.videoIdentity.fingerprint`,
        'videoIdentity.fingerprint must match trial.fingerprint.',
      );
    }
    if (!isObject(entry.exportProvenance)) {
      pushError(errors, `${prefix}.exportProvenance`, 'exportProvenance is required.');
    }
    if (trial.track != null) {
      if (!isObject(trial.track)) {
        pushError(errors, `${prefix}.trial.track`, 'track must be an object when present.');
      } else if (!Array.isArray(trial.track.observations)) {
        pushError(errors, `${prefix}.trial.track.observations`, 'track.observations array is required.');
      }
    }
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    bundle: raw as unknown as NeuroTrackBundle,
  };
}

export function parseNeuroTrackBundleJson(json: string): ReturnType<typeof validateNeuroTrackBundle> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      errors: [{ path: '$', message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }],
    };
  }
  return validateNeuroTrackBundle(parsed);
}
