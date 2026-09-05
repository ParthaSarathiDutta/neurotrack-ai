# Phase 0 Findings — Decode and Timing Spike

Generated: 2026-09-05T18:41:00.252Z

## Environment

- **Browser:** Chromium 153.0.8010.12
- **User agent:** Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36
- **Platform:** darwin
- **Node:** v23.11.0

## Validation summary (V1–V9)

| Criterion | Result |
|-----------|--------|
| V1 | **PASS** |
| V2 | **PASS** |
| V3 | **PASS** |
| V4 | **PASS** |
| V5 | **PASS** |
| V6 | **PASS** |
| V7 | **PASS** |
| V8 | **PASS** |
| V9 | **PASS** |

## Primary path (WebCodecs + mp4box.js in Worker)

### test50.mp4

- Wall-clock decode: **0.73 s**
- Track duration: 185.067 s
- Track timescale: 15360
- Codec: avc1.640020; coded 640×480
- avcC hdr stripped: 8 bytes
- Dimensions: {"stsd_visual_entry_width":640,"stsd_visual_entry_height":480,"track_video_width":640,"track_video_height":480,"track_track_width":640,"track_track_height":480}
- Frame counts:
  - ffprobe nb_frames: 5539
  - mp4box nb_samples: 5539
  - decoder outputs: 5539
  - **Discrepancies:** all three counts match
- Mean interval (cts/timescale): **0.034418403 s**

### test51.mp4

- Wall-clock decode: **0.11 s**
- Track duration: 49.383 s
- Track timescale: 15000
- Codec: avc1.640020; coded 640×480
- avcC hdr stripped: 8 bytes
- Dimensions: {"stsd_visual_entry_width":640,"stsd_visual_entry_height":480,"track_video_width":640,"track_video_height":480,"track_track_width":640,"track_track_height":480}
- Frame counts:
  - ffprobe nb_frames: 741
  - mp4box nb_samples: 741
  - decoder outputs: 741
  - **Discrepancies:** all three counts match
- **test51 timing (V2):**
  - Median interval (unique cts): **0.066733333 s** (1001 ticks @ timescale 15000)
  - Mean interval (unique cts): 0.068210143 s — skewed by duplicate cts (17 duplicates) and occasional 2001/2002-tick gaps
  - Confirms **1001/15000 s**, not 15 fps (1000/15000): median delta 0.000 µs from expected

### test53.mp4

- Wall-clock decode: **0.16 s**
- Track duration: 30.233 s
- Track timescale: 15360
- Codec: avc1.640020; coded 640×480
- avcC hdr stripped: 8 bytes
- Dimensions: {"stsd_visual_entry_width":640,"stsd_visual_entry_height":480,"track_video_width":640,"track_video_height":480,"track_track_width":640,"track_track_height":480}
- Frame counts:
  - ffprobe nb_frames: 905
  - mp4box nb_samples: 905
  - decoder outputs: 905
  - **Discrepancies:** all three counts match
- Mean interval (cts/timescale): **0.034357224 s**

## Fallback (video + requestVideoFrameCallback)

- **test50.mp4 @ 1×**: wall 185.07 s, callbacks 5338, presentedFrames final 5338, ffprobe nb_frames 5539, decoder outputs 5539, monotonic true, gaps 0, ratio 1.000
- **test51.mp4 @ 1×**: wall 49.39 s, callbacks 717, presentedFrames final 717, ffprobe nb_frames 741, decoder outputs 741, monotonic true, gaps 0, ratio 1.000
- **test53.mp4 @ 1×**: wall 30.24 s, callbacks 873, presentedFrames final 873, ffprobe nb_frames 905, decoder outputs 905, monotonic true, gaps 0, ratio 1.000

**Frame-count note:** rVFC callback count can be lower than container/decoder frame counts (e.g. test50: 5338 callbacks vs 5539 frames) without `presentedFrames` gaps — treat as incomplete frame delivery, not silent agreement.

### 4× playbackRate experiment

- **test50.mp4**: wall 185.08 s, ratio 1.000, gaps 0, callbacks 5338 (1× had 5338)
- **test51.mp4**: wall 49.40 s, ratio 1.000, gaps 0, callbacks 717 (1× had 717)
- **test53.mp4**: wall 30.24 s, ratio 1.000, gaps 0, callbacks 873 (1× had 873)

**Headless Chromium note:** playbackRate=4 did not reduce wall-clock vs 1× in this environment — do not assume faster-than-real-time batch decode via rVFC.

## Recommendation

**Recommend WebCodecs VideoDecoder + mp4box.js in a dedicated Worker as the production primary decode path.**

All three sample clips decode without error (V1). test51 frame spacing matches 1001/15000 s (V2). test50 throughput exceeds the usability bar (V5).

Reserve `<video>` + `requestVideoFrameCallback` for human review/scrubbing and as a feature-detected fallback when WebCodecs is unavailable — not for batch analysis.

## Constitution wording (D7)

Replace: "does not expose reliable per-frame presentation timestamps"

With: "`requestVideoFrameCallback` exposes per-frame `mediaTime` (presentation timestamps) and `presentedFrames` (skip detection). The fallback is unsuitable for analysis because it is main-thread-only and wall-clock throughput tracks playback speed (~1× real time at playbackRate=1; faster only via raised playbackRate with frame-gap risk). Use it for review/scrubbing and when WebCodecs is unavailable."

V7 empirical result: PASS