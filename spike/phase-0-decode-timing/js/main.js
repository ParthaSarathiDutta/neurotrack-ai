/**
 * Phase 0 harness orchestrator (main thread).
 */
import { runFallbackDecode, captureFallbackThumbnail } from './fallback.js';
import { extractDecoderConfig, ctsToMicroseconds } from './mp4-utils.js';
import { createFile } from '../node_modules/mp4box/dist/mp4box.all.mjs';

const worker = new Worker('./js/decode-worker.js', { type: 'module' });

/** @type {Record<string, unknown>} */
export const spikeState = {
  results: null,
  running: false,
};

/**
 * Probe mp4box metadata without full decode (for isConfigSupported per file).
 * @param {ArrayBuffer} buffer
 */
function probeMp4Metadata(buffer) {
  return new Promise((resolve, reject) => {
    const mp4 = createFile();
    mp4.onReady = (info) => {
      const track = info.videoTracks[0];
      try {
        const extract = extractDecoderConfig(mp4, track);
        resolve({
          movieTimescale: info.timescale,
          movieDurationSec: info.duration / info.timescale,
          track,
          extract,
        });
      } catch (e) {
        reject(e);
      }
    };
    mp4.onError = reject;
    buffer.fileStart = 0;
    mp4.appendBuffer(buffer);
    mp4.flush();
  });
}

/**
 * @param {File} file
 */
async function runPrimaryDecode(file) {
  const buffer = await file.arrayBuffer();
  const copy = buffer.slice(0);
  const id = `${file.name}-${Date.now()}`;

  return new Promise((resolve, reject) => {
    const onMessage = (ev) => {
      if (ev.data.id !== id) return;
      worker.removeEventListener('message', onMessage);
      if (ev.data.type === 'done') resolve(ev.data.result);
      else reject(new Error(ev.data.error));
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ type: 'decode', buffer: copy, fileName: file.name, id });
  });
}

/**
 * @param {File} file
 */
async function runPerFileFeatureDetection(file) {
  const buffer = await file.arrayBuffer();
  const meta = await probeMp4Metadata(buffer);

  if (typeof VideoDecoder === 'undefined') {
    return {
      fileName: file.name,
      videoDecoderAvailable: false,
      isConfigSupported: false,
      config: null,
      meta,
    };
  }

  const config = {
    codec: meta.extract.codec,
    codedWidth: meta.extract.codedWidth,
    codedHeight: meta.extract.codedHeight,
    description: meta.extract.description,
  };

  const support = await VideoDecoder.isConfigSupported(config);

  return {
    fileName: file.name,
    videoDecoderAvailable: true,
    isConfigSupported: support.supported,
    config: support.config,
    meta: {
      trackTimescale: meta.track.timescale,
      nb_samples: meta.track.nb_samples,
      codec: meta.track.codec,
      dimensionSources: meta.extract.dimensionSources,
    },
  };
}

/**
 * Run full spike battery on files.
 * @param {File[]} files
 * @param {object} ffprobeByFile - keyed by basename
 */
export async function runSpikeBattery(files, ffprobeByFile = {}) {
  spikeState.running = true;
  const report = {
    generatedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    primary: [],
    fallback: [],
    fallbackFast: [],
    featureDetection: [],
    thumbnails: {},
  };

  for (const file of files) {
    report.featureDetection.push(await runPerFileFeatureDetection(file));

    const primary = await runPrimaryDecode(file);
    report.primary.push({
      ...primary,
      thumbnail: undefined,
      ffprobe: ffprobeByFile[file.name] ?? null,
    });

    if (primary.thumbnail) {
      report.thumbnails[`${file.name}-primary`] = primary.thumbnail;
    }

    const fallback = await runFallbackDecode(file, { playbackRate: 1 });
    report.fallback.push(fallback);

    const fallbackFast = await runFallbackDecode(file, { playbackRate: 4 });
    report.fallbackFast.push(fallbackFast);

    try {
      const thumb = await captureFallbackThumbnail(file);
      report.thumbnails[`${file.name}-fallback`] = thumb;
    } catch {
      /* optional */
    }
  }

  spikeState.results = report;
  spikeState.running = false;
  return report;
}

// UI wiring when loaded in browser
const runBtn = document.getElementById('run');
const fileInput = document.getElementById('files');
const statusEl = document.getElementById('status');
const outputEl = document.getElementById('output');

if (runBtn && fileInput) {
  runBtn.addEventListener('click', async () => {
    const files = [...fileInput.files];
    if (!files.length) {
      statusEl.textContent = 'Select at least one MP4 file.';
      return;
    }
    runBtn.disabled = true;
    statusEl.textContent = 'Running spike…';
    try {
      const report = await runSpikeBattery(files);
      const serializable = JSON.parse(
        JSON.stringify(report, (_k, v) => (v instanceof ImageBitmap ? '[ImageBitmap]' : v)),
      );
      outputEl.textContent = JSON.stringify(serializable, null, 2);
      statusEl.textContent = 'Done. See output JSON below.';
      window.__spikeResults = report;
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
    } finally {
      runBtn.disabled = false;
    }
  });
}

// Export for automation
window.runSpikeBattery = runSpikeBattery;
window.spikeState = spikeState;
