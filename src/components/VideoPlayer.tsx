import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { BehavioralEvent, Geometry, Observation, TimestampIndexEntry, TrialWindow } from '../domain/types';
import { formatCleaningQualityFlags } from '../domain/trajectory/cleaningLabels';
import { isEstimatedBodyPosition } from '../domain/trajectory/observationEstimate';
import { secondsFromTimeUs } from '../domain/timing';
import { computeLetterboxedContentRect } from '../domain/videoTransform';
import { useVideoPlayer } from '../hooks/useVideoPlayer';
import { VideoOverlay } from './VideoOverlay';
import { TrajectoryOverlay } from './visualization/TrajectoryOverlay';
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
  trajectoryObservations?: Observation[];
  trajectoryTrialStartUs?: number | null;
  trajectoryCensorUs?: number | null;
  behavioralEvents?: BehavioralEvent[];
  previewRawBodyXY?: { x: number; y: number } | null;
  selectedHoleId: number | null;
  onHoleClick?: (holeId: number) => void;
  onCanvasClick?: (x: number, y: number) => void;
  onFrameIndexChange?: (frameIndex: number) => void;
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
  trajectoryObservations = [],
  trajectoryTrialStartUs = null,
  trajectoryCensorUs = null,
  behavioralEvents = [],
  previewRawBodyXY = null,
  selectedHoleId,
  onHoleClick,
  onCanvasClick,
  onFrameIndexChange,
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
  const [gotoFrameInput, setGotoFrameInput] = useState('');
  const [showTrajectory, setShowTrajectory] = useState(true);

  // Keep the "go to frame" field showing the current frame when it isn't being edited,
  // so it doubles as a live readout that stays synchronized with stepping/slider/seek.
  useEffect(() => {
    setGotoFrameInput(String(player.currentFrameIndex + 1));
  }, [player.currentFrameIndex]);

  const commitGotoFrame = useCallback(() => {
    const n = Number(gotoFrameInput);
    if (Number.isFinite(n)) {
      void player.loadFrame(Math.round(n) - 1);
    } else {
      setGotoFrameInput(String(player.currentFrameIndex + 1));
    }
  }, [gotoFrameInput, player]);

  const handleGotoFrameKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitGotoFrame();
    }
  };

  useEffect(() => {
    onFrameIndexChange?.(player.currentFrameIndex);
  }, [player.currentFrameIndex, onFrameIndexChange]);

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
    if (!canvas || !player.frameBitmap) return;
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
  }, [player.frameBitmap, displayBox]);

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

  const escapeEvent = behavioralEvents.find((e) => e.type !== 'investigation') ?? null;
  const investigationSpans =
    durationSec > 0
      ? behavioralEvents
          .filter((e) => e.type === 'investigation' && e.status !== 'rejected')
          .map((e) => ({
            id: e.id,
            leftFrac: secondsFromTimeUs(e.startTimeUs) / durationSec,
            widthFrac: Math.max(
              0.001,
              (secondsFromTimeUs(e.endTimeUs) - secondsFromTimeUs(e.startTimeUs)) / durationSec,
            ),
            manual: e.origin === 'manual',
          }))
      : [];
  const entryOnsetFrac =
    escapeEvent?.entryOnsetTimeUs != null && durationSec > 0
      ? secondsFromTimeUs(escapeEvent.entryOnsetTimeUs) / durationSec
      : null;
  const censorFrac =
    escapeEvent?.censorBoundaryTimeUs != null && durationSec > 0
      ? secondsFromTimeUs(escapeEvent.censorBoundaryTimeUs) / durationSec
      : null;

  return (
    <div className={styles.playerSection}>
      <div ref={containerRef} className={styles.playerContainer} data-testid="video-player">
        {player.videoUrl && (
          <video
            ref={player.videoRef}
            src={player.videoUrl}
            className={styles.playerVideo}
            width={videoWidth}
            height={videoHeight}
            muted
            playsInline
            hidden={player.mode !== 'video'}
            data-testid="player-video-element"
            data-playing={player.playing ? 'true' : 'false'}
          />
        )}
        <canvas
          ref={frameCanvasRef}
          className={styles.playerFrameCanvas}
          aria-hidden={player.mode !== 'frame'}
          hidden={player.mode !== 'frame'}
          data-testid="player-frame-canvas"
        />
        <TrajectoryOverlay
          observations={trajectoryObservations}
          displayBox={displayBox}
          trialStartUs={trajectoryTrialStartUs ?? 0}
          censorUs={trajectoryCensorUs ?? 0}
          visible={
            showTrajectory &&
            trajectoryTrialStartUs != null &&
            trajectoryCensorUs != null &&
            trajectoryObservations.length > 0
          }
          currentFrameIndex={player.currentFrameIndex}
        />
        <VideoOverlay
          geometry={geometry}
          displayBox={displayBox}
          selectedHoleId={selectedHoleId}
          observation={currentObservation}
          previewRawBodyXY={previewRawBodyXY}
          onHoleClick={onHoleClick}
          onCanvasClick={onCanvasClick}
        />
      </div>

      <div hidden aria-hidden="true" data-testid="observation-debug">
        <span data-testid="observation-origin">{currentObservation?.origin ?? 'none'}</span>
        <span data-testid="observation-body-x">{currentObservation?.bodyXY?.x ?? ''}</span>
        <span data-testid="observation-body-y">{currentObservation?.bodyXY?.y ?? ''}</span>
        <span data-testid="observation-quality-flags">
          {currentObservation?.qualityFlags?.length
            ? formatCleaningQualityFlags(currentObservation.qualityFlags)
            : ''}
        </span>
        <span data-testid="observation-estimated">
          {isEstimatedBodyPosition(currentObservation) ? 'true' : 'false'}
        </span>
        <span data-testid="preview-raw-body-x">{previewRawBodyXY?.x ?? ''}</span>
        <span data-testid="preview-raw-body-y">{previewRawBodyXY?.y ?? ''}</span>
        <span
          data-testid="preview-raw-marker-active"
          data-active={previewRawBodyXY ? 'true' : 'false'}
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
        <button
          type="button"
          className={styles.button}
          aria-pressed={showTrajectory}
          data-testid="trajectory-toggle-btn"
          onClick={() => setShowTrajectory((v) => !v)}
        >
          {showTrajectory ? 'Hide trajectory' : 'Show trajectory'}
        </button>
        <label className={styles.playbackSpeedLabel} htmlFor="playback-speed">
          Speed
          <select
            id="playback-speed"
            className={styles.playbackSpeedSelect}
            value={player.playbackSpeed}
            onChange={(e) => player.setPlaybackSpeed(Number(e.target.value) as 0.25 | 0.5 | 1 | 2)}
            data-testid="playback-speed"
          >
            <option value={0.25}>0.25×</option>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
        </label>
        <span className={styles.timestamp} data-testid="current-timestamp">
          {secondsFromTimeUs(currentTimeUs).toFixed(6)} s
        </span>
        <span className={styles.frameLabel} data-testid="current-frame-index">
          Frame {player.currentFrameIndex + 1}/{player.maxFrameIndex + 1}
        </span>
        <label className={styles.gotoFrameLabel} htmlFor="goto-frame-input">
          Go to frame
        </label>
        <input
          id="goto-frame-input"
          type="number"
          min={1}
          max={player.maxFrameIndex + 1}
          className={styles.gotoFrameInput}
          value={gotoFrameInput}
          onChange={(e) => setGotoFrameInput(e.target.value)}
          onKeyDown={handleGotoFrameKeyDown}
          onBlur={commitGotoFrame}
          data-testid="goto-frame-input"
        />
        <button
          type="button"
          className={styles.button}
          onClick={commitGotoFrame}
          data-testid="goto-frame-btn"
        >
          Go
        </button>
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
        {investigationSpans.length > 0 && (
          <div className={styles.eventMarkerStrip} aria-hidden="true" data-testid="event-marker-strip">
            {investigationSpans.map((span) => (
              <div
                key={span.id}
                className={`${styles.eventInvestigationSpan}${span.manual ? ` ${styles.eventInvestigationSpanManual}` : ''}`}
                style={{ left: `${span.leftFrac * 100}%`, width: `${span.widthFrac * 100}%` }}
                data-testid="event-investigation-span"
              />
            ))}
            {entryOnsetFrac != null && (
              <div
                className={styles.eventEntryOnsetMarker}
                style={{ left: `${entryOnsetFrac * 100}%` }}
                data-testid="event-entry-onset-marker"
              />
            )}
            {censorFrac != null && (
              <div
                className={styles.eventCensorMarker}
                style={{ left: `${censorFrac * 100}%` }}
                data-testid="event-censor-marker"
              />
            )}
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
