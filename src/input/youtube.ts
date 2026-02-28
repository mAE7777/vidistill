import { tmpdir } from 'os';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { YtDlp } from 'ytdlp-nodejs';
import { log } from '@clack/prompts';
import pc from 'picocolors';
import type { GeminiClient } from '../gemini/client.js';
import { MODELS } from '../gemini/models.js';

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

export async function handleYouTube(url: string, client: GeminiClient): Promise<YouTubeResult> {
  // Attempt direct Gemini URL processing first
  try {
    await client.generate({
      model: MODELS.flash,
      contents: [
        {
          role: 'user',
          parts: [
            { fileData: { fileUri: url, mimeType: 'video/mp4' } },
            { text: 'ok' },
          ],
        },
      ],
      config: {},
    });
    return { fileUri: url, mimeType: 'video/mp4', source: 'direct' };
  } catch (err) {
    log.warn(pc.dim('Direct Gemini probe failed. Falling back to yt-dlp.'));
  }

  const tempPath = await downloadWithYtDlp(url);
  try {
    const uploaded = await client.uploadFile(tempPath);
    return {
      fileUri: uploaded.uri,
      mimeType: uploaded.mimeType,
      source: 'ytdlp',
      duration: uploaded.duration,
      uploadedFileName: uploaded.name,
    };
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

export async function downloadWithYtDlp(url: string): Promise<string> {
  const ytdlp = new YtDlp();

  const installed = ytdlp.checkInstallation();
  if (!installed) {
    throw new Error('yt-dlp is required for private videos. Install: brew install yt-dlp');
  }

  const videoId = extractVideoId(url) ?? 'video';
  const outputPath = join(tmpdir(), `vidistill-${videoId}-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);

  await ytdlp.downloadAsync(url, {
    output: outputPath,
    format: {
      filter: 'videoonly',
      quality: '720p',
      type: 'mp4',
    },
  });

  return outputPath;
}
