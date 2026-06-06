import { execFileSync } from 'child_process';
import { unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface ClipPlan {
  index: number;
  startTime: number;
  endTime: number;
  /** Seconds of overlap appended after the nominal end. 0 for the last clip. */
  overlapDuration: number;
}

export interface ClipInfo extends ClipPlan {
  filePath: string;
}

/** Default clip length in seconds (20 minutes). */
export const CLIP_DURATION_SEC = 20 * 60;

/** Overlap between consecutive clips in seconds. */
export const CLIP_OVERLAP_SEC = 30;

/** Minimum video duration to trigger splitting (25 minutes). */
export const CLIP_THRESHOLD_SEC = 25 * 60;

/** Maximum concurrent clip uploads / processing lanes. */
export const CLIP_CONCURRENCY = 4;

export function shouldSplitIntoClips(durationSec: number): boolean {
  return Number.isFinite(durationSec) && durationSec > CLIP_THRESHOLD_SEC;
}

export function createClipPlan(
  durationSec: number,
  clipDuration: number = CLIP_DURATION_SEC,
  overlap: number = CLIP_OVERLAP_SEC,
): ClipPlan[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];

  // If the video is shorter than one clip + overlap, treat as single clip
  if (durationSec <= clipDuration + overlap) {
    return [{ index: 0, startTime: 0, endTime: durationSec, overlapDuration: 0 }];
  }

  const clips: ClipPlan[] = [];
  let start = 0;
  let index = 0;

  while (start < durationSec) {
    const isLast = start + clipDuration >= durationSec;
    const end = isLast ? durationSec : start + clipDuration + overlap;
    clips.push({
      index,
      startTime: start,
      endTime: Math.min(end, durationSec),
      overlapDuration: isLast ? 0 : overlap,
    });
    start += clipDuration;
    index++;
  }

  return clips;
}

function clipTempPath(index: number): string {
  const rand = Math.random().toString(36).slice(2);
  return join(tmpdir(), `vidistill-clip-${Date.now()}-${index}-${rand}.mp4`);
}

/**
 * Split a video file into clips using ffmpeg stream-copy (no re-encoding).
 * Returns temp file paths that the caller must clean up.
 */
export async function splitVideo(
  filePath: string,
  clipPlan: ClipPlan[],
): Promise<ClipInfo[]> {
  const clips: ClipInfo[] = [];

  for (const plan of clipPlan) {
    const outPath = clipTempPath(plan.index);
    const duration = plan.endTime - plan.startTime;

    try {
      execFileSync('ffmpeg', [
        '-y',
        '-ss', String(plan.startTime),
        '-t', String(duration),
        '-i', filePath,
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        outPath,
      ], { stdio: 'ignore' });
    } catch {
      cleanupClips(clips);
      throw new Error(
        `Failed to split video at clip ${plan.index}. Ensure ffmpeg is installed: brew install ffmpeg`,
      );
    }

    clips.push({ ...plan, filePath: outPath });
  }

  return clips;
}

/** Best-effort removal of temp clip files. */
export function cleanupClips(clips: ClipInfo[]): void {
  for (const clip of clips) {
    try {
      unlinkSync(clip.filePath);
    } catch {
      // best-effort
    }
  }
}
