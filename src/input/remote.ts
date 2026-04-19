import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { YtDlp } from 'ytdlp-nodejs';
import type { GeminiClient, UploadedFile } from '../gemini/client.js';
import { tryUnlink } from './local-file.js';

const DOWNLOAD_FORMAT =
  'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best';

function tempPath(): string {
  return join(tmpdir(), `vidistill-remote-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
}

function findYtDlp(): string | null {
  try {
    return execFileSync('which', ['yt-dlp'], { encoding: 'utf-8' }).trim() || null;
  } catch {
    return null;
  }
}

export interface RemoteUrlResult {
  fileUri: string;
  mimeType: string;
  duration: number | undefined;
  title: string;
  uploadedFileName?: string;
}

export async function handleRemoteUrl(
  url: string,
  client: GeminiClient,
): Promise<RemoteUrlResult> {
  const binaryPath = findYtDlp();
  if (!binaryPath) {
    throw new Error(
      'yt-dlp is required for non-YouTube URLs. Install: brew install yt-dlp',
    );
  }

  const ytdlp = new YtDlp({ binaryPath });

  let title: string = url;
  let duration: number | undefined;

  try {
    const info = await ytdlp.getInfoAsync<'video'>(url);
    if (info.title) title = info.title;
    if (typeof info.duration === 'number' && info.duration > 0) {
      duration = info.duration;
    }
  } catch {
    // metadata fetch failure is non-fatal — use URL as title fallback and proceed
  }

  const outPath = tempPath();

  try {
    await ytdlp.downloadAsync(url, {
      output: outPath,
      format: DOWNLOAD_FORMAT,
    });

    const uploaded: UploadedFile = await client.uploadFile(outPath);

    return {
      fileUri: uploaded.uri,
      mimeType: uploaded.mimeType,
      duration: duration ?? uploaded.duration,
      title,
      uploadedFileName: uploaded.name,
    };
  } finally {
    tryUnlink(outPath);
  }
}
