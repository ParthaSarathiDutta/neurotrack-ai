import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimestampIndexEntry } from '../domain/types';
import {
  indexEntryByFrameIndex,
  nearestIndexEntry,
  stepFrameIndex,
} from '../domain/videoTransform';
import { secondsFromTimeUs } from '../domain/timing';
import { getFrameBitmap, initFrameDecoder } from '../services/frameService';
import { getCachedVideo } from '../db/videoCache';

export type PlayerMode = 'video' | 'frame';

export const PLAYBACK_SPEED_OPTIONS = [0.25, 0.5, 1, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEED_OPTIONS)[number];

export interface UseVideoPlayerOptions {
  fingerprint: string;
  timestampIndex: TimestampIndexEntry[];
  videoWidth: number;
  videoHeight: number;
}

export function useVideoPlayer({
  fingerprint,
  timestampIndex,
  videoWidth,
  videoHeight,
}: UseVideoPlayerOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rVfcId = useRef<number>(0);
  const loadGenRef = useRef(0);
  const currentFrameIndexRef = useRef(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<PlayerMode>('frame');
  const [playing, setPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeedState] = useState<PlaybackSpeed>(1);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [frameBitmap, setFrameBitmap] = useState<ImageBitmap | null>(null);
  const [loading, setLoading] = useState(true);

  const maxFrameIndex = Math.max(0, timestampIndex.length - 1);
  const currentEntry =
    indexEntryByFrameIndex(timestampIndex, currentFrameIndex) ??
    timestampIndex[0] ??
    null;

  useEffect(() => {
    currentFrameIndexRef.current = currentFrameIndex;
  }, [currentFrameIndex]);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      setLoading(true);
      setVideoUrl(null);
      const cached = await getCachedVideo(fingerprint);
      if (cancelled) return;
      if (cached) {
        url = URL.createObjectURL(cached.blob);
        setVideoUrl(url);
      }
      await initFrameDecoder(fingerprint);
      if (cancelled) return;
      setLoading(false);
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fingerprint]);

  const cancelRvfc = useCallback((video: HTMLVideoElement) => {
    if (rVfcId.current) {
      video.cancelVideoFrameCallback(rVfcId.current);
      rVfcId.current = 0;
    }
  }, []);

  const loadFrame = useCallback(
    async (frameIndex: number) => {
      const gen = ++loadGenRef.current;
      const clamped = stepFrameIndex(frameIndex, 0, maxFrameIndex);
      setCurrentFrameIndex(clamped);
      currentFrameIndexRef.current = clamped;
      setMode('frame');
      setPlaying(false);
      if (videoRef.current) {
        videoRef.current.pause();
        cancelRvfc(videoRef.current);
      }

      const bitmap = await getFrameBitmap(clamped, videoWidth, videoHeight, fingerprint);
      if (gen !== loadGenRef.current) {
        bitmap.close();
        return;
      }
      setFrameBitmap((prev) => {
        prev?.close();
        return bitmap;
      });
    },
    [maxFrameIndex, videoWidth, videoHeight, fingerprint, cancelRvfc],
  );

  useEffect(() => {
    if (!loading) void loadFrame(0);
  }, [loading, fingerprint]); // eslint-disable-line react-hooks/exhaustive-deps

  const pauseToFrame = useCallback(
    (frameIndex: number) => {
      const video = videoRef.current;
      if (video) {
        video.pause();
        cancelRvfc(video);
      }
      setPlaying(false);
      setMode('frame');
      void loadFrame(frameIndex);
    },
    [loadFrame, cancelRvfc],
  );

  const handlePlaybackEnded = useCallback(() => {
    const video = videoRef.current;
    if (video) cancelRvfc(video);
    setPlaying(false);
    void loadFrame(0);
  }, [loadFrame, cancelRvfc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    video.loop = false;
    video.playbackRate = playbackSpeed;
    video.addEventListener('ended', handlePlaybackEnded);
    return () => video.removeEventListener('ended', handlePlaybackEnded);
  }, [videoUrl, playbackSpeed, handlePlaybackEnded]);

  const setPlaybackSpeed = useCallback((speed: PlaybackSpeed) => {
    setPlaybackSpeedState(speed);
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, []);

  const stepFrame = useCallback(
    (delta: number) => {
      void loadFrame(currentFrameIndexRef.current + delta);
    },
    [loadFrame],
  );

  const seekToTimeUs = useCallback(
    (timeUs: number) => {
      const entry = nearestIndexEntry(timestampIndex, timeUs, {
        preferredFrameIndex: currentFrameIndexRef.current,
      });
      if (entry) void loadFrame(entry.frameIndex);
    },
    [timestampIndex, loadFrame],
  );

  const seekToSeconds = useCallback(
    (seconds: number) => seekToTimeUs(Math.round(seconds * 1_000_000)),
    [seekToTimeUs],
  );

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    if (playing) {
      pauseToFrame(currentFrameIndexRef.current);
      return;
    }

    setMode('video');
    video.playbackRate = playbackSpeed;
    video.currentTime = currentEntry ? secondsFromTimeUs(currentEntry.timeUs) : 0;
    cancelRvfc(video);
    setPlaying(true);

    const onFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      const entry = nearestIndexEntry(
        timestampIndex,
        Math.round(metadata.mediaTime * 1_000_000),
        { preferredFrameIndex: currentFrameIndexRef.current },
      );
      if (entry) setCurrentFrameIndex(entry.frameIndex);
      if (!video.paused && !video.ended) {
        rVfcId.current = video.requestVideoFrameCallback(onFrame);
      }
    };
    rVfcId.current = video.requestVideoFrameCallback(onFrame);
    void video.play().catch(() => {
      cancelRvfc(video);
      setPlaying(false);
      void loadFrame(currentFrameIndexRef.current);
    });
  }, [playing, videoUrl, currentEntry, timestampIndex, cancelRvfc, pauseToFrame, playbackSpeed, loadFrame]);

  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (video) cancelRvfc(video);
      setFrameBitmap((prev) => {
        prev?.close();
        return null;
      });
    };
  }, [cancelRvfc]);

  return {
    videoRef,
    videoUrl,
    mode,
    playing,
    playbackSpeed,
    loading,
    currentFrameIndex,
    currentEntry,
    frameBitmap,
    maxFrameIndex,
    stepFrame,
    seekToTimeUs,
    seekToSeconds,
    togglePlay,
    loadFrame,
    setPlaybackSpeed,
  };
}
