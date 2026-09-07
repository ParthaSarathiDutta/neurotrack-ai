# NeuroTrack analysis bundle schema (v1.0.0)

Versioned JSON interchange format for reloading Barnes maze analysis without re-tracking.

**File extension:** `.neurotrack.json`  
**MIME type:** `application/json`

## Top-level object

| Field | Type | Required | Description |
|---|---|---|---|
| `schemaVersion` | `"1.0.0"` | yes | Schema semver; unsupported versions are rejected |
| `bundleType` | `"neurotrack-analysis"` | yes | Discriminator |
| `exportedAt` | ISO-8601 string | yes | Export timestamp (provenance) |
| `toolVersion` | string | yes | NeuroTrack tool version at export |
| `analysisParams` | `AnalysisParams` | yes | Session parameters snapshot |
| `selectedTrialId` | string \| null | yes | UI selection at export |
| `trials` | `BundleTrialEntry[]` | yes | One entry per tracked trial (non-empty) |

MP4 video bytes are **never** embedded. Video identity uses content **fingerprint**; `fileName` is a hint only.

## BundleTrialEntry

| Field | Type | Description |
|---|---|---|
| `trial` | `TrialRecord` | Full trial state (`videoCached` forced `false` on export) |
| `videoIdentity` | object | Fingerprint + metadata hints for relinking |
| `exportProvenance` | object | Review counts, escape summary, stale flags at export |

### trial (TrialRecord)

Includes when present:

- `metadata`, `timestampIndex` — container timing index
- `trialWindow`, `geometry` — calibration and protocol window
- `track.observations` — immutable raw tracking
- `track.manualCorrections`, `track.appliedCleaning`
- `events`, `measures`, `measurementBasis`

### videoIdentity

```json
{
  "fingerprint": "sha256-content-id",
  "fileName": "test53.mp4",
  "durationSec": 30.23,
  "nbSamples": 905,
  "containerFrameRateLabel": "30/1"
}
```

Import matches trials to cached video blobs by **fingerprint only**. When no blob matches, the trial is restored with `ingestStatus: needs_reselect` and analysis data intact.

### exportProvenance

Audit snapshot: measurement basis, event review counts, escape state label, cleaning/events stale flags.

## Import behavior

1. Parse and validate entire bundle (all-or-nothing).
2. Run `migrateTrialRecord` / `migrateAnalysisParams` for compatibility.
3. Detect collisions with existing session (same `trial.id` or same fingerprint, different id).
4. If collisions exist, require explicit user confirmation before replacing existing trials.
5. Restore stored `events` and `measures` exactly — no automatic re-track or re-detect.
6. Optional explicit **Recompute measures from events** action recomputes measures only.

## Example (truncated)

```json
{
  "schemaVersion": "1.0.0",
  "bundleType": "neurotrack-analysis",
  "exportedAt": "2026-09-07T18:00:00.000Z",
  "toolVersion": "0.5.0-ms5",
  "analysisParams": { "id": "default", "toolVersion": "0.5.0-ms5" },
  "selectedTrialId": "trial-abc",
  "trials": [
    {
      "trial": {
        "id": "trial-abc",
        "fingerprint": "fp123",
        "fileName": "test53.mp4",
        "track": { "status": "done", "observations": [] }
      },
      "videoIdentity": {
        "fingerprint": "fp123",
        "fileName": "test53.mp4",
        "durationSec": 30.23,
        "nbSamples": 905,
        "containerFrameRateLabel": "30/1"
      },
      "exportProvenance": {
        "measurementBasis": "corrected",
        "eventReviewCounts": { "proposed": 0, "confirmed": 1, "rejected": 0, "manual": 0 },
        "escapeState": "Completion at 24.40 s; 24.40 s total latency",
        "cleaningStale": false,
        "eventsStale": false
      }
    }
  ]
}
```

See `src/domain/export/bundleSchema.ts` for validation rules.
