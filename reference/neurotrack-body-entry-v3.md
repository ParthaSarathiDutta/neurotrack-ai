# NeuroTrack body-entry completion — operational default v3

**Definition ID:** `neurotrack_body_entry` · **Version:** `3`

Supersedes [v2](./neurotrack-body-entry-v2.md). Scientific definition unchanged: head and torso in hole; tail may remain visible.

## What changed in v3

v2 allowed **Path B (occlusion-aware)** pixel proxies to auto-finalize `escape_completed`. Audit showed those proxies cannot distinguish full torso entry from partial entry (test51: auto completion at display 674 while substantial body visible at 701).

v3 treats Path B as **possible body-entry evidence only** — not sufficient proof for an automatic completion timestamp.

## Automatic completion (Path A only)

**Centroid-confirmed:** strict torso proximity (6% radius) **and** pixel torso entry **and** temporal support (≥2 consecutive frames).

Only Path A may establish `completionEstablished` and auto `escape_completed`.

## Possible entry evidence (Path B — not auto-completion)

**Occlusion-aware:** Phase-A approach zone + pixel torso entry + adjacent-frame temporal progression.

When present without Path A completion → `escape_entry_uncertain` (candidate hole, entry onset, censor lower bound preserved; total latency censored until scientist confirms).

## Manual review

Scientist may confirm `escape_completed` with an explicit completion frame, or retain uncertain/censored outcome. Target-hole confirmation remains separate from candidate-hole entry evidence.
