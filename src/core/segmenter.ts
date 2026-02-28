import { MediaResolution } from '@google/genai';
import type { Segment } from '../types/index.js';

export interface SegmentPlan {
  segments: Segment[];
  resolution: MediaResolution;
}

const SECONDS_PER_MINUTE = 60;
const DEFAULT_SEGMENT_SECONDS = 10 * SECONDS_PER_MINUTE;
const SHORT_VIDEO_THRESHOLD = 10 * SECONDS_PER_MINUTE;
const MEDIUM_VIDEO_THRESHOLD = 30 * SECONDS_PER_MINUTE;
const LONG_VIDEO_THRESHOLD = 60 * SECONDS_PER_MINUTE;

const RESOLUTION_MAP: Record<string, MediaResolution> = {
  low: MediaResolution.MEDIA_RESOLUTION_LOW,
  medium: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
  high: MediaResolution.MEDIA_RESOLUTION_HIGH,
};

export function createSegmentPlan(
  durationSeconds: number,
  options?: { segmentMinutes?: number; resolution?: string },
): SegmentPlan {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    durationSeconds = 0;
  }

  const segmentSeconds = options?.segmentMinutes !== undefined
    ? options.segmentMinutes * SECONDS_PER_MINUTE
    : DEFAULT_SEGMENT_SECONDS;

  if (!Number.isFinite(segmentSeconds) || segmentSeconds <= 0) {
    return {
      segments: [{ index: 0, startTime: 0, endTime: durationSeconds }],
      resolution: MediaResolution.MEDIA_RESOLUTION_LOW,
    };
  }

  const resolutionOverride = options?.resolution !== undefined
    ? RESOLUTION_MAP[options.resolution]
    : undefined;

  if (durationSeconds <= SHORT_VIDEO_THRESHOLD) {
    return {
      segments: [{ index: 0, startTime: 0, endTime: durationSeconds }],
      resolution: resolutionOverride ?? MediaResolution.MEDIA_RESOLUTION_MEDIUM,
    };
  }

  if (durationSeconds <= MEDIUM_VIDEO_THRESHOLD) {
    return {
      segments: [{ index: 0, startTime: 0, endTime: durationSeconds }],
      resolution: resolutionOverride ?? MediaResolution.MEDIA_RESOLUTION_LOW,
    };
  }

  const computedResolution = durationSeconds <= LONG_VIDEO_THRESHOLD
    ? MediaResolution.MEDIA_RESOLUTION_MEDIUM
    : MediaResolution.MEDIA_RESOLUTION_LOW;

  const count = Math.ceil(durationSeconds / segmentSeconds);
  const segments: Segment[] = [];

  for (let i = 0; i < count; i++) {
    const startTime = i * segmentSeconds;
    const endTime = i === count - 1 ? durationSeconds : (i + 1) * segmentSeconds;
    segments.push({ index: i, startTime, endTime });
  }

  return { segments, resolution: resolutionOverride ?? computedResolution };
}
