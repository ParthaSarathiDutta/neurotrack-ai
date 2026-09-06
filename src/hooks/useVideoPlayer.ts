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

  const loadFrame = useCallback(
    async (frameIndex: number) => {
      const gen = ++loadGenRef.current;
      const clamped = stepFrameIndex(frameIndex, 0, maxFrameIndex);
      setCurrentFrameIndex(clamped);
      currentFrameIndexRef.current = clamped;
      setMode('frame');
      setPlaying(false);
      if (videoRef.current) videoRef.current.pause();

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
    [maxFrameIndex, videoWidth, videoHeight, fingerprint],
  );

  useEffect(() => {
    if (!loading) void loadFrame(0);
  }, [loading, fingerprint]); // eslint-disable-line react-hooks/exhaustive-deps

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
      video.pause();
      cancelAnimationFrame(rVfcId.current);
      setPlaying(false);
      setMode('frame');
      return;
    }

    setMode('video');
    setFrameBitmap((prev) => {
      prev?.close();
      return null;
    });
    video.currentTime = currentEntry ? secondsFromTimeUs(currentEntry.timeUs) : 0;
    void video.play();
    setPlaying(true);

    const onFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      const entry = nearestIndexEntry(
        timestampIndex,
        Math.round(metadata.mediaTime * 1_000_000),
        { preferredFrameIndex: currentFrameIndexRef.current },
      );
      if (entry) setCurrentFrameIndex(entry.frameIndex);
      if (!video.paused) {
        rVfcId.current = video.requestVideoFrameCallback(onFrame);
      }
    };
    rVfcId.current = video.requestVideoFrameCallback(onFrame);
  }, [playing, videoUrl, currentEntry, timestampIndex]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rVfcId.current);
      setFrameBitmap((prev) => {
        prev?.close();
        return null;
      });
    };
  }, []);

  return {
    videoRef,
    videoUrl,
    mode,
    playing,
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
  };
}
