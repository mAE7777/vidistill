import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Pass2Result, VisualNote } from '../types/index.js';
import { formatTime, parseTimestamp } from '../lib/utils.js';

export interface KeyframeConfig {
  filePath: string;
  pass2Results: (Pass2Result | null)[];
  maxFrames?: number;
  outputDir: string;
}

export interface KeyframeFrame {
  timestamp: string;
  path: string;
  description: string;
}

export interface KeyframeResult {
  frames: KeyframeFrame[];
  errors: string[];
}

const DEFAULT_MAX_FRAMES = 50;
const DEDUP_WINDOW_SECONDS = 3;
const SLIDE_TYPES = new Set(['slide', 'diagram', 'whiteboard']);

function isRemoteUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

function collectTimestamps(pass2Results: (Pass2Result | null)[]): string[] {
  const timestamps: string[] = [];

  for (const result of pass2Results) {
    if (result == null) continue;

    // Collect screen_timeline entries where screen_state changes
    let prevState: string | null = null;
    for (const entry of result.screen_timeline) {
      if (entry.screen_state !== prevState) {
        timestamps.push(entry.timestamp);
        prevState = entry.screen_state;
      }
    }

    // Collect visual_notes of slide/diagram/whiteboard type
    for (const note of result.visual_notes) {
      if (SLIDE_TYPES.has(note.visual_type)) {
        timestamps.push(note.timestamp);
      }
    }
  }

  return timestamps;
}

function deduplicateTimestamps(timestamps: string[]): string[] {
  const seconds = timestamps.map((ts) => ({ ts, secs: parseTimestamp(ts) }));
  seconds.sort((a, b) => a.secs - b.secs);

  const result: { ts: string; secs: number }[] = [];
  for (const entry of seconds) {
    const last = result[result.length - 1];
    if (last == null || entry.secs - last.secs >= DEDUP_WINDOW_SECONDS) {
      result.push(entry);
    }
  }

  return result.map((e) => e.ts);
}

function sampleTimestamps(timestamps: string[], maxFrames: number): string[] {
  if (timestamps.length <= maxFrames) return timestamps;

  const step = timestamps.length / maxFrames;
  const sampled: string[] = [];
  for (let i = 0; i < maxFrames; i++) {
    const idx = Math.min(Math.round(i * step), timestamps.length - 1);
    sampled.push(timestamps[idx]);
  }
  return sampled;
}

function findDescription(
  timestamp: string,
  pass2Results: (Pass2Result | null)[],
): string {
  const targetSecs = parseTimestamp(timestamp);

  let bestNote: VisualNote | null = null;
  let bestNoteDist = Infinity;
  let fallbackState: string | null = null;
  let fallbackStateDist = Infinity;

  for (const result of pass2Results) {
    if (result == null) continue;

    for (const note of result.visual_notes) {
      const dist = Math.abs(parseTimestamp(note.timestamp) - targetSecs);
      if (dist < bestNoteDist) {
        bestNoteDist = dist;
        bestNote = note;
      }
    }

    for (const entry of result.screen_timeline) {
      const dist = Math.abs(parseTimestamp(entry.timestamp) - targetSecs);
      if (dist < fallbackStateDist) {
        fallbackStateDist = dist;
        fallbackState = entry.screen_state;
      }
    }
  }

  if (bestNote != null) return bestNote.description;
  if (fallbackState != null) return fallbackState;
  return '';
}

function timestampToFilename(timestamp: string): string {
  // Convert HH:MM:SS to HH-MM-SS for filename safety
  const secs = parseTimestamp(timestamp);
  return formatTime(secs).replace(/:/g, '-');
}

export async function extractKeyframes(config: KeyframeConfig): Promise<KeyframeResult> {
  const { filePath, pass2Results, maxFrames = DEFAULT_MAX_FRAMES, outputDir } = config;

  // Skip extraction for YouTube direct URLs or missing local files
  if (!filePath || isRemoteUrl(filePath) || !existsSync(filePath)) {
    return { frames: [], errors: [] };
  }

  const imagesDir = join(outputDir, 'images');
  mkdirSync(imagesDir, { recursive: true });

  const rawTimestamps = collectTimestamps(pass2Results);
  const deduped = deduplicateTimestamps(rawTimestamps);
  const sampled = sampleTimestamps(deduped, maxFrames);

  const frames: KeyframeFrame[] = [];
  const errors: string[] = [];

  for (const timestamp of sampled) {
    const filenamePart = timestampToFilename(timestamp);
    const outputPath = join(imagesDir, `frame-${filenamePart}.png`);

    try {
      execFileSync('ffmpeg', [
        '-y',
        '-ss', timestamp,
        '-i', filePath,
        '-frames:v', '1',
        '-q:v', '2',
        outputPath,
      ]);

      const description = findDescription(timestamp, pass2Results);
      frames.push({ timestamp, path: outputPath, description });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to extract frame at ${timestamp}: ${message}`);
    }
  }

  return { frames, errors };
}
