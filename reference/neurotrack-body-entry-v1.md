# NeuroTrack body-entry completion — operational default v1

**Definition ID:** `neurotrack_body_entry` · **Version:** `1`

This is NeuroTrack AI’s **default** operational definition for Barnes maze escape completion. It is **not** claimed to be universal across laboratories — scientists may confirm, reject, or override via manual review.

## Completed body entry

**Head and torso have passed into the escape hole.** A visible tail (or other posterior remnant on the platform) **does not** disqualify completion.

## Distinguished from

| Pattern | Meaning |
|---|---|
| **Nose poke / rim investigation** | Nose or body near the hole opening without sustained torso proximity and pixel entry signals |
| **Partial torso entry** | Approach and shrinkage without temporally supported torso-in-hole evidence |
| **Uncertain occlusion** | Ambiguous pixels or missing trajectory at the candidate frame — treat as incomplete, not completed |
| **Full-animal disappearance** | **Not required** — tail may remain visible |

## Detection rule (auto pipeline)

Per presentation-order frame after entry onset:

1. **Torso proximity (trajectory):** tracked body center within `bodyEntryTorsoProximityFraction × platformRadius` of the candidate hole.
2. **Hole occupancy (pixel):** hole-region darkening ≥ `bodyEntryHoleDarkeningMin`.
3. **Platform remnant allowed (pixel):** platform foreground blob area ≤ `bodyEntryPlatformAreaMaxFraction ×` pre-entry baseline (permits tail on platform).
4. **Temporal support:** ≥ `bodyEntryTemporalMinFrames` consecutive frames meeting (1–3).

**First defensible completion frame** = first frame of the earliest qualifying consecutive run.

**Aggregate area decay** is supporting evidence only (confidence score) — never sufficient alone for completion.

**Recording end** is never used as a fallback completion timestamp. Completion at the final frame requires that frame to pass the per-frame body-entry criteria with temporal support.
