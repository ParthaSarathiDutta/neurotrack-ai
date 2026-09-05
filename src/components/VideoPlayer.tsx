import { useCallback, useEffect, useRef, useState } from 'react';
import type { Geometry, Observation, TimestampIndexEntry, TrialWindow } from '../domain/types';
import { secondsFromTimeUs } from '../domain/timing';
import { computeLetterboxedContentRect } from '../domain/videoTransform';
import { useVideoPlayer } from '../hooks/useVideoPlayer';
import { VideoOverlay } from './VideoOverlay';
import styles from '../styles/app.module.css';

interface VideoPlayerProps {
  fingerprint: string;
  timestampIndex: TimestampIndexEntry[];
  videoWidth: number;
  videoHeight: number;
  durationSec: number;
  geometry: Geometry;
  trialWindow: TrialWindow;
  observations?: Observation[];
  selectedHoleId: number | null;
  onHoleClick?: (holeId: number) => void;
  onCanvasClick?: (x: number, y: number) => void;
  onSeek?: (timeUs: number) => void;
  onRegisterSeek?: (api: {
    loadFrame: (frameIndex: number) => void;
    seekToTimeUs: (timeUs: number) => void;
  }) => void;
}

export function VideoPlayer({
  fingerprint,
  timestampIndex,
  videoWidth,
  videoHeight,
  durationSec,
  geometry,
  trialWindow,
  observations = [],
  selectedHoleId,
  onHoleClick,
  onCanvasClick,
  onSeek,
  onRegisterSeek,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement>(null);
  const [displayBox, setDisplayBox] = useState({
    displayWidth: videoWidth,
    displayHeight: videoHeight,
    videoWidth,
    videoHeight,
  });

  const player = useVideoPlayer({ fingerprint, timestampIndex, videoWidth, videoHeight });

  useEffect(() => {
    onRegisterSeek?.({
      loadFrame: player.loadFrame,
      seekToTimeUs: player.seekToTimeUs,
    });
  }, [onRegisterSeek, player.loadFrame, player.seekToTimeUs]);

  const currentObservation =
    observations.find((o) => o.frameIndex === player.currentFrameIndex) ?? null;

  const updateDisplayBox = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setDisplayBox({
      displayWidth: rect.width,
      displayHeight: rect.height,
      videoWidth,
      videoHeight,
    });
  }, [videoWidth, videoHeight]);

  useEffect(() => {
    updateDisplayBox();
    const ro = new ResizeObserver(updateDisplayBox);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [updateDisplayBox]);

  useEffect(() => {
    const canvas = frameCanvasRef.current;
    if (!canvas || !player.frameBitmap || player.mode !== 'frame') return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = displayBox.displayWidth * dpr;
    canvas.height = displayBox.displayHeight * dpr;
    canvas.style.width = `${displayBox.displayWidth}px`;
    canvas.style.height = `${displayBox.displayHeight}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayBox.displayWidth, displayBox.displayHeight);
    const content = computeLetterboxedContentRect(displayBox);
    ctx.drawImage(
      player.frameBitmap,
      0,
      0,
      displayBox.videoWidth,
      displayBox.videoHeight,
      content.offsetX,
      content.offsetY,
      content.contentWidth,
      content.contentHeight,
    );
  }, [player.frameBitmap, player.mode, displayBox]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          player.togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          player.stepFrame(e.shiftKey ? -15 : -1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          player.stepFrame(e.shiftKey ? 15 : 1);
          break;
        case 'Home':
          e.preventDefault();
          void player.loadFrame(0);
          break;
        case 'End':
          e.preventDefault();
          void player.loadFrame(player.maxFrameIndex);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player]);

  const currentTimeUs = player.currentEntry?.timeUs ?? 0;
  const progress = durationSec > 0 ? secondsFromTimeUs(currentTimeUs) / durationSec : 0;

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const frac = Number(e.target.value) / 1000;
    const timeUs = Math.round(frac * durationSec * 1_000_000);
    player.seekToTimeUs(timeUs);
    onSeek?.(timeUs);
  };

  const startFrac =
    trialWindow.startTimeUs != null ? secondsFromTimeUs(trialWindow.startTimeUs) / durationSec : 0;
  const endFrac =
    trialWindow.endTimeUs != null ? secondsFromTimeUs(trialWindow.endTimeUs) / durationSec : 1;
  const cutoffFrac =
    trialWindow.startTimeUs != null && trialWindow.cutoffSeconds
      ? (secondsFromTimeUs(trialWindow.startTimeUs) + trialWindow.cutoffSeconds) / durationSec
      : 1;

  const trackingSegments =
    observations.length > 0 && durationSec > 0
      ? observations.map((o) => ({
          startFrac: secondsFromTimeUs(o.timeUs) / durationSec,
          status: o.observed,
        }))
      : [];

  return (
    <div className={styles.playerSection}>
      <div ref={containerRef} className={styles.playerContainer} data-testid="video-player">
        {player.mode === 'video' && player.videoUrl && (
          <video
            ref={player.videoRef}
            src={player.videoUrl}
            className={styles.playerVideo}
            width={videoWidth}
            height={videoHeight}
            muted
            playsInline
          />
        )}
        {player.mode === 'frame' && (
          <canvas ref={frameCanvasRef} className={styles.playerFrameCanvas} aria-hidden="true" />
        )}
        <VideoOverlay
          geometry={geometry}
          displayBox={displayBox}
          selectedHoleId={selectedHoleId}
          observation={currentObservation}
          onHoleClick={onHoleClick}
          onCanvasClick={onCanvasClick}
        />
      </div>

      <div className={styles.playerControls}>
        <button
          type="button"
          className={styles.button}
          onClick={player.togglePlay}
          aria-label={player.playing ? 'Pause' : 'Play'}
          data-testid="play-pause-btn"
        >
          {player.playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => player.stepFrame(-1)}
          aria-label="Previous frame"
          data-testid="step-back-btn"
        >
          ◀ Frame
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => player.stepFrame(1)}
          aria-label="Next frame"
          data-testid="step-forward-btn"
        >
          Frame ▶
        </button>
        <span className={styles.timestamp} data-testid="current-timestamp">
          {secondsFromTimeUs(currentTimeUs).toFixed(6)} s
        </span>
        <span className={styles.frameLabel} data-testid="current-frame-index">
          Frame {player.currentFrameIndex + 1}/{player.maxFrameIndex + 1}
        </span>
      </div>

      <div className={styles.timelineWrap}>
        <div className={styles.timelineRegions} aria-hidden="true">
          <div className={styles.regionPreTrial} style={{ width: `${startFrac * 100}%` }} />
          <div
            className={styles.regionTrial}
            style={{
              left: `${startFrac * 100}%`,
              width: `${(Math.min(endFrac, cutoffFrac) - startFrac) * 100}%`,
            }}
          />
          <div
            className={styles.regionPostCutoff}
            style={{
              left: `${Math.min(cutoffFrac, endFrac) * 100}%`,
              width: `${(1 - Math.min(cutoffFrac, endFrac)) * 100}%`,
            }}
          />
        </div>
        {trackingSegments.length > 0 && (
          <div className={styles.trackingQualityStrip} aria-hidden="true" data-testid="tracking-quality-strip">
            {trackingSegments.map((seg, i) => {
              const nextFrac =
                i + 1 < trackingSegments.length
                  ? trackingSegments[i + 1].startFrac
                  : 1;
              const widthFrac = Math.max(0, nextFrac - seg.startFrac);
              const cls =
                seg.status === 'tracked'
                  ? styles.trackSegmentTracked
                  : seg.status === 'lost'
                    ? styles.trackSegmentLost
                    : seg.status === 'absent_in_hole'
                      ? styles.trackSegmentAbsent
                      : styles.trackSegmentPreTrial;
              return (
                <div
                  key={`${seg.startFrac}-${i}`}
                  className={cls}
                  style={{ left: `${seg.startFrac * 100}%`, width: `${widthFrac * 100}%` }}
                />
              );
            })}
          </div>
        )}
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          onChange={handleScrub}
          className={styles.timelineSlider}
          aria-label="Video timeline"
          data-testid="timeline-slider"
        />
      </div>

      <details className={styles.details}>
        <summary>Keyboard shortcuts</summary>
        <ul className={styles.shortcutList}>
          <li><kbd>Space</kbd> — Play / Pause</li>
          <li><kbd>←</kbd> / <kbd>→</kbd> — Step one frame</li>
          <li><kbd>Shift</kbd> + <kbd>←</kbd> / <kbd>→</kbd> — Step 15 frames</li>
          <li><kbd>Home</kbd> / <kbd>End</kbd> — First / last frame</li>
        </ul>
      </details>
    </div>
  );
}
