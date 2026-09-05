import Dexie, { type EntityTable } from 'dexie';
import type { AnalysisParams, PersistedSession, TrialRecord } from '../domain/types';
import { TOOL_VERSION, defaultTrackingParams } from '../domain/trialFactory';

export interface VideoBlobRecord {
  fingerprint: string;
  blob: Blob;
  byteSize: number;
  fileName: string;
  lastAccessedAt: string;
}

export interface StoredSession extends PersistedSession {
  id: 'active';
}

export class NeuroTrackDatabase extends Dexie {
  session!: EntityTable<StoredSession, 'id'>;
  videoBlobs!: EntityTable<VideoBlobRecord, 'fingerprint'>;

  constructor() {
    super('NeuroTrackDB');
    this.version(1).stores({
      session: 'id',
      videoBlobs: 'fingerprint, lastAccessedAt',
    });
  }
}

export const db = new NeuroTrackDatabase();

const SESSION_ID = 'active';

export function defaultAnalysisParams(): AnalysisParams {
  return {
    id: 'default',
    toolVersion: TOOL_VERSION,
    tracking: defaultTrackingParams(),
    updatedAt: new Date().toISOString(),
  };
}

export async function loadSession(): Promise<PersistedSession | null> {
  const row = await db.session.get(SESSION_ID);
  if (!row) return null;
  return {
    trials: row.trials,
    selectedTrialId: row.selectedTrialId,
    analysisParams: row.analysisParams,
  };
}

export async function saveSession(session: PersistedSession): Promise<void> {
  await db.session.put({ ...session, id: SESSION_ID });
}

export async function clearSessionForTests(): Promise<void> {
  await db.session.clear();
  await db.videoBlobs.clear();
}

/** Rehydrate trials and mark cache availability from blob store. */
export async function attachCacheFlags(trials: TrialRecord[]): Promise<TrialRecord[]> {
  const fingerprints = await db.videoBlobs.orderBy('fingerprint').keys();
  const cached = new Set(fingerprints as string[]);
  return trials.map((trial) => ({
    ...trial,
    videoCached: cached.has(trial.fingerprint),
    ingestStatus:
      trial.metadata && !cached.has(trial.fingerprint) ? 'needs_reselect' : trial.ingestStatus,
  }));
}
