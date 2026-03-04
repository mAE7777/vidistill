import { execFile } from 'child_process';
import type { GeminiClient } from '../gemini/client.js';

const YOUTUBE_PATTERNS = [
  /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
];

export function extractVideoId(url: string): string | null {
  for (const pattern of YOUTUBE_PATTERNS) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function isValidYouTubeUrl(url: string): boolean {
  return extractVideoId(url) !== null;
}

export function normalizeYouTubeUrl(url: string): string | null {
  const id = extractVideoId(url);
  if (!id) return null;
  return `https://www.youtube.com/watch?v=${id}`;
}

export async function fetchYouTubeMetadata(
  url: string,
): Promise<{ title: string; author: string; thumbnailUrl: string }> {
  const normalized = normalizeYouTubeUrl(url);
  if (!normalized) throw new Error('Invalid YouTube URL');

  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(normalized)}&format=json`;

  const res = await fetch(oembedUrl);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('Video is private or unavailable');
    }
    throw new Error(`Failed to fetch video info (${res.status})`);
  }

  const data: unknown = await res.json();
  const obj = data as Record<string, unknown>;
  return {
    title: typeof obj['title'] === 'string' ? obj['title'] : 'Untitled',
    author: typeof obj['author_name'] === 'string' ? obj['author_name'] : 'Unknown',
    thumbnailUrl: typeof obj['thumbnail_url'] === 'string' ? obj['thumbnail_url'] : '',
  };
}

export interface YouTubeResult {
  fileUri: string;
  mimeType: string;
  source: 'direct' | 'ytdlp';
  duration?: number;
  uploadedFileName?: string;
}

/**
 * Fetch video duration (in seconds) via yt-dlp --dump-json.
 * Returns undefined if yt-dlp is not installed or the command fails.
 */
export function fetchYtDlpDuration(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile('yt-dlp', ['--dump-json', '--no-download', url], { timeout: 15_000 }, (err, stdout) => {
      if (err) {
        resolve(undefined);
        return;
      }
      try {
        const data = JSON.parse(stdout) as Record<string, unknown>;
        const dur = data['duration'];
        if (typeof dur === 'number' && dur > 0) {
          resolve(dur);
        } else {
          resolve(undefined);
        }
      } catch {
        resolve(undefined);
      }
    });
  });
}

export async function handleYouTube(url: string, _client: GeminiClient): Promise<YouTubeResult> {
  // Try to get duration from yt-dlp metadata (no download)
  const duration = await fetchYtDlpDuration(url);

  // Gemini accepts public YouTube URLs directly as fileUri (no upload needed)
  return { fileUri: url, mimeType: 'video/mp4', source: 'direct', duration };
}
