/**
 * Phase 0 fallback path: <video> + requestVideoFrameCallback on main thread.
 * Measures mediaTime, presentedFrames, wall-clock, and frame gaps experimentally.
 */

/**
 * @param {File} file
 * @param {{ playbackRate?: number }} options
 */
export function runFallbackDecode(file, options = {}) {
  const playbackRate = options.playbackRate ?? 1;

  return new Promise((resolve, reject) => {
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
      reject(new Error('requestVideoFrameCallback not supported'));
      return;
    }

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.playbackRate = playbackRate;

    const url = URL.createObjectURL(file);
    video.src = url;

    /** @type {Array<{mediaTime: number, presentedFrames: number, now: number}>} */
    const callbacks = [];
    let previousPresented = null;
    /** @type {Array<{from: number, to: number, gap: number}>} */
    const presentedGaps = [];
    let wallStart = null;
    let wallEnd = null;
    let thumbnail = null;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };

    video.addEventListener('error', () => {
      cleanup();
      reject(new Error(`Video error: ${video.error?.message ?? 'unknown'}`));
    });

    video.addEventListener('loadedmetadata', () => {
      wallStart = performance.now();
      video.play().catch(reject);
    });

    const onFrame = (now, metadata) => {
      if (wallStart === null) wallStart = performance.now();

      callbacks.push({
        mediaTime: metadata.mediaTime,
        presentedFrames: metadata.presentedFrames,
        now,
      });

      if (previousPresented !== null && metadata.presentedFrames > previousPresented + 1) {
        presentedGaps.push({
          from: previousPresented,
          to: metadata.presentedFrames,
          gap: metadata.presentedFrames - previousPresented - 1,
        });
      }
      previousPresented = metadata.presentedFrames;

      if (!thumbnail && metadata.mediaTime > 1) {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          canvas.toBlob(() => {}, 'image/jpeg', 0.85);
        }
      }

      if (video.ended || metadata.mediaTime >= video.duration - 0.001) {
        wallEnd = performance.now();
        finish();
        return;
      }

      video.requestVideoFrameCallback(onFrame);
    };

    video.addEventListener('ended', () => {
      if (wallEnd === null) wallEnd = performance.now();
      finish();
    });

    let finished = false;
    function finish() {
      if (finished) return;
      finished = true;

      const wallMs = wallEnd != null && wallStart != null ? wallEnd - wallStart : null;
      const mediaTimes = callbacks.map((c) => c.mediaTime);
      const intervals = [];
      for (let i = 1; i < mediaTimes.length; i += 1) {
        intervals.push(mediaTimes[i] - mediaTimes[i - 1]);
      }

      const monotonic = mediaTimes.every((t, i) => i === 0 || t >= mediaTimes[i - 1]);

      resolve({
        fileName: file.name,
        path: 'video-rVFC',
        playbackRate,
        videoDurationSec: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        wallClockMs: wallMs,
        callbackCount: callbacks.length,
        finalPresentedFrames: callbacks.length ? callbacks[callbacks.length - 1].presentedFrames : 0,
        presentedGaps,
        mediaTimeMonotonic: monotonic,
        mediaTimesFirst5: mediaTimes.slice(0, 5),
        mediaTimesLast3: mediaTimes.slice(-3),
        intervalsFirst10: intervals.slice(0, 10),
        meanIntervalSec:
          intervals.length > 0
            ? intervals.reduce((a, b) => a + b, 0) / intervals.length
            : null,
        realTimeRatio:
          wallMs != null && video.duration > 0 ? video.duration / (wallMs / 1000) : null,
      });

      cleanup();
    }

    video.requestVideoFrameCallback(onFrame);
  });
}

/**
 * Capture one thumbnail from fallback path mid-playback.
 * @param {File} file
 */
export async function captureFallbackThumbnail(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;

    video.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      reject(new Error('thumbnail capture failed'));
    });

    video.addEventListener('loadeddata', async () => {
      video.currentTime = Math.min(10, video.duration * 0.5);
    });

    video.addEventListener('seeked', async () => {
      try {
        const bitmap = await createImageBitmap(video);
        URL.revokeObjectURL(url);
        video.remove();
        resolve(bitmap);
      } catch (e) {
        reject(e);
      }
    });
  });
}
