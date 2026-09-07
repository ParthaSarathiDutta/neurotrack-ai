# NeuroTrack body-entry completion — operational default v2

**Definition ID:** `neurotrack_body_entry` · **Version:** `2`

Supersedes [v1](./neurotrack-body-entry-v1.md) for auto-detection. The **scientific definition is unchanged**: head and torso have passed into the escape hole; a visible tail **does not** disqualify completion. Not claimed universal across laboratories.

## What changed in v2

v1 required tracked body-centroid proximity (6% platform radius) **and** pixel entry on every qualifying frame. During real hole entry the centroid often **lags** on the platform lip while the torso is already in the hole (centroid bias under partial occlusion).

v2 adds an **occlusion-aware pixel torso path** when pixels and temporal progression establish entry without relying on centroid distance as an absolute veto.

## Completed body entry (unchanged semantics)

**Head and torso have passed into the escape hole.** Tail or other posterior remnant on the platform is permitted.

## Distinguished from

| Pattern | v2 handling |
|---|---|
| **Nose poke** | Hole darkening without sustained platform-area reduction and/or body outside Phase-A approach zone |
| **Rim exploration** | Approach without pixel torso entry (insufficient darkening or no area reduction) |
| **Partial torso entry** | Pixel signals without temporal support (≥2 frames) |
| **Centroid-only near miss** | Occlusion path: approach zone + pixel entry + progression — centroid strict gate is supporting, not required |
| **Uncertain occlusion** | Ambiguous or missing pixels → incomplete, not completed |

## Detection rule (auto pipeline)

Per frame after entry onset, **pixel torso entry** requires:

1. Hole-region darkening ≥ `bodyEntryHoleDarkeningMin`
2. Platform foreground blob ≤ `bodyEntryPlatformAreaMaxFraction ×` pre-entry baseline (tail remnant allowed)

**Qualifying frame** — either path:

| Path | Criteria |
|---|---|
| **A — Centroid-confirmed** | Strict torso proximity (6% radius) **and** pixel torso entry |
| **B — Occlusion-aware** | Phase-A approach proximity (`escapeProximityFraction`, 12% radius) **and** pixel torso entry **and** adjacent-frame temporal progression (hole darkening non-decreasing or platform area non-increasing vs prior frame in the pair) |

Strict centroid proximity remains **supporting evidence** (Path A). It is **not** an absolute veto when Path B is met.

**Temporal support:** ≥ `bodyEntryTemporalMinFrames` consecutive qualifying frames.

**First defensible completion frame** = first frame of the earliest qualifying consecutive run.

**Aggregate area decay** is supporting score only — never sufficient alone.

**Recording end** is never a fallback completion timestamp.
