import { migrateAnalysisParams, migrateTrialRecord } from '../migration';
import { markTrialNeedsReselect } from '../trialFactory';
import type { AnalysisParams, TrialRecord } from '../types';
import { validateNeuroTrackBundle, type NeuroTrackBundle } from './bundleSchema';

export interface ImportCollision {
  incomingTrialId: string;
  incomingFileName: string;
  incomingFingerprint: string;
  existingTrialId: string;
  existingFileName: string;
  existingFingerprint: string;
  reason: 'trial_id' | 'fingerprint';
}

export interface ImportPreview {
  bundle: NeuroTrackBundle;
  collisions: ImportCollision[];
  importedTrialCount: number;
  trialsNeedingVideoReselect: string[];
}

export interface ApplyImportInput {
  bundle: NeuroTrackBundle;
  existingTrials: TrialRecord[];
  existingSelectedTrialId: string | null;
  existingAnalysisParams: AnalysisParams;
  replaceConfirmed: boolean;
  cachedFingerprints: Set<string>;
}

export type ApplyImportResult =
  | { ok: false; reason: 'collision'; collisions: ImportCollision[] }
  | { ok: false; reason: 'validation'; errors: { path: string; message: string }[] }
  | {
      ok: true;
      trials: TrialRecord[];
      analysisParams: AnalysisParams;
      selectedTrialId: string | null;
      trialsNeedingVideoReselect: string[];
      replacedTrialIds: string[];
    };

export function detectImportCollisions(
  bundle: NeuroTrackBundle,
  existingTrials: TrialRecord[],
): ImportCollision[] {
  const collisions: ImportCollision[] = [];
  const seen: ImportCollision[] = [];

  for (const entry of bundle.trials) {
    const incoming = entry.trial;
    const byId = existingTrials.find((t) => t.id === incoming.id);
    if (byId) {
      seen.push({
        incomingTrialId: incoming.id,
        incomingFileName: incoming.fileName,
        incomingFingerprint: incoming.fingerprint,
        existingTrialId: byId.id,
        existingFileName: byId.fileName,
        existingFingerprint: byId.fingerprint,
        reason: 'trial_id',
      });
    }
    const byFp = existingTrials.find(
      (t) => t.fingerprint === incoming.fingerprint && t.id !== incoming.id,
    );
    if (byFp) {
      seen.push({
        incomingTrialId: incoming.id,
        incomingFileName: incoming.fileName,
        incomingFingerprint: incoming.fingerprint,
        existingTrialId: byFp.id,
        existingFileName: byFp.fileName,
        existingFingerprint: byFp.fingerprint,
        reason: 'fingerprint',
      });
    }
  }

  const keys = new Set<string>();
  for (const c of seen) {
    const key = `${c.reason}:${c.existingTrialId}:${c.incomingTrialId}`;
    if (!keys.has(key)) {
      keys.add(key);
      collisions.push(c);
    }
  }
  return collisions;
}

export function previewBundleImport(
  raw: unknown,
  existingTrials: TrialRecord[],
  cachedFingerprints: Set<string>,
): ApplyImportResult | ImportPreview {
  const validated = validateNeuroTrackBundle(raw);
  if (!validated.ok) {
    return { ok: false, reason: 'validation', errors: validated.errors };
  }

  const bundle = validated.bundle;
  const collisions = detectImportCollisions(bundle, existingTrials);
  const trialsNeedingVideoReselect = bundle.trials
    .filter((e) => !cachedFingerprints.has(e.trial.fingerprint))
    .map((e) => e.trial.id);

  return {
    bundle,
    collisions,
    importedTrialCount: bundle.trials.length,
    trialsNeedingVideoReselect,
  };
}

function attachVideoCacheFlags(
  trial: TrialRecord,
  cachedFingerprints: Set<string>,
): TrialRecord {
  if (cachedFingerprints.has(trial.fingerprint)) {
    return {
      ...trial,
      videoCached: true,
      ingestStatus: trial.metadata ? 'ready' : trial.ingestStatus,
    };
  }
  return markTrialNeedsReselect({
    ...trial,
    videoCached: false,
  });
}

/**
 * Apply a validated bundle to session state.
 * Restores stored events and measures exactly — no re-track or re-detect.
 * Requires replaceConfirmed=true when collisions exist.
 */
export function applyBundleImport(input: ApplyImportInput): ApplyImportResult {
  const validated = validateNeuroTrackBundle(input.bundle);
  if (!validated.ok) {
    return { ok: false, reason: 'validation', errors: validated.errors };
  }

  const bundle = validated.bundle;
  const collisions = detectImportCollisions(bundle, input.existingTrials);
  if (collisions.length > 0 && !input.replaceConfirmed) {
    return { ok: false, reason: 'collision', collisions };
  }

  const replacedIds = new Set<string>();
  for (const c of collisions) {
    replacedIds.add(c.existingTrialId);
  }

  const migratedIncoming = bundle.trials.map((entry) => {
    const migrated = migrateTrialRecord({
      ...entry.trial,
      videoCached: false,
    });
    return attachVideoCacheFlags(migrated, input.cachedFingerprints);
  });

  const incomingIds = new Set(migratedIncoming.map((t) => t.id));
  const kept = input.existingTrials.filter(
    (t) => !replacedIds.has(t.id) && !incomingIds.has(t.id),
  );

  const trials = [...kept, ...migratedIncoming];
  const analysisParams = migrateAnalysisParams(bundle.analysisParams);

  let selectedTrialId = bundle.selectedTrialId;
  if (selectedTrialId && !trials.some((t) => t.id === selectedTrialId)) {
    selectedTrialId = migratedIncoming[0]?.id ?? kept[0]?.id ?? null;
  }
  if (!selectedTrialId) {
    selectedTrialId = input.existingSelectedTrialId;
  }

  const trialsNeedingVideoReselect = migratedIncoming
    .filter((t) => !input.cachedFingerprints.has(t.fingerprint))
    .map((t) => t.id);

  return {
    ok: true,
    trials,
    analysisParams,
    selectedTrialId,
    trialsNeedingVideoReselect,
    replacedTrialIds: [...replacedIds],
  };
}

export function trialsDeepEqualForImport(a: TrialRecord, b: TrialRecord): boolean {
  return JSON.stringify(stripVolatileTrialFields(a)) === JSON.stringify(stripVolatileTrialFields(b));
}

function stripVolatileTrialFields(trial: TrialRecord): TrialRecord {
  return {
    ...trial,
    videoCached: false,
    updatedAt: '',
  };
}
