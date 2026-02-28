import { createRequire } from 'module';
import { log } from '@clack/prompts';

const _require = createRequire(import.meta.url);
// fluent-ffmpeg is a CJS-only package; createRequire is the correct ESM interop approach
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpeg = _require('fluent-ffmpeg') as typeof import('fluent-ffmpeg');

// Bytes-per-second rough estimate used when no other duration source is available
const BYTES_PER_SECOND = 500_000;

export interface DurationSource {
  /** Absolute path to a local file (used for ffprobe and size-based fallback) */
  filePath?: string | undefined;
  /** File size in bytes (used for size-based fallback when filePath is not available) */
  fileSize?: number | undefined;
  /** Duration returned directly by Gemini after upload (seconds) */
  geminiDuration?: number | undefined;
  /** Duration extracted by yt-dlp (seconds) */
  ytDlpDuration?: number | undefined;
}

/**
 * Wrap fluent-ffmpeg's callback-based ffprobe() as a Promise.
 * Resolves with the duration in seconds, or rejects on error.
 */
function ffprobeAsync(filePath: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      const duration = data.format.duration;
      if (typeof duration !== 'number' || isNaN(duration)) {
        reject(new Error('ffprobe returned no duration'));
        return;
      }
      resolve(duration);
    });
  });
}

/**
 * Detect duration (in seconds) for a video source using a priority-ordered
 * fallback chain:
 *
 * 1. Local file  → ffprobe via fluent-ffmpeg
 * 2. Gemini metadata → duration returned by uploadFile()
 * 3. yt-dlp metadata → duration from yt-dlp
 * 4. File size estimate → fileSize / 500000 (warns the user)
 *
 * Throws if no duration can be determined at all.
 */
export async function detectDuration(source: DurationSource): Promise<number> {
  // 1. ffprobe (local files only)
  if (source.filePath !== undefined) {
    try {
      const duration = await ffprobeAsync(source.filePath);
      return duration;
    } catch (err) {
      // Check whether the error is a "not found" / "not installed" type
      const message = err instanceof Error ? err.message : String(err);
      const isNotFound =
        /ENOENT|not found|no such file|spawn.*ffprobe|Cannot find/i.test(message);
      if (isNotFound) {
        log.warn(
          'ffprobe not found — video duration will be estimated. Install: brew install ffmpeg',
        );
      }
      // Fall through to next method regardless of error type
    }
  }

  // 2. Gemini metadata
  if (source.geminiDuration !== undefined && source.geminiDuration > 0) {
    return source.geminiDuration;
  }

  // 3. yt-dlp metadata
  if (source.ytDlpDuration !== undefined && source.ytDlpDuration > 0) {
    return source.ytDlpDuration;
  }

  // 4. File size estimate
  let bytes: number | undefined;
  if (source.filePath !== undefined) {
    try {
      const { statSync } = await import('fs');
      bytes = statSync(source.filePath).size;
    } catch {
      // ignore — fall through to explicit fileSize field
    }
  }
  if (bytes === undefined && source.fileSize !== undefined) {
    bytes = source.fileSize;
  }

  if (bytes !== undefined && bytes > 0) {
    log.warn(
      'Duration estimated from file size — segmentation may be inaccurate',
    );
    return Math.max(1, Math.round(bytes / BYTES_PER_SECOND));
  }

  throw new Error('Unable to determine video duration: no file path, metadata, or file size available');
}
