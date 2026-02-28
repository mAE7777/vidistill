import { existsSync, statSync, openSync, readSync, closeSync, unlinkSync } from 'fs';
import * as childProc from 'child_process';
import { tmpdir } from 'os';
import { join, extname, basename } from 'path';
import { log } from '@clack/prompts';
import type { GeminiClient, UploadedFile } from '../gemini/client.js';

const GB = 1024 * 1024 * 1024;
const SIZE_3GB = 3 * GB;
const SIZE_2GB = 2 * GB;

export interface LocalFileResult {
  fileUri: string;
  mimeType: string;
  duration: number | undefined;
  uploadedFileName?: string;
}

interface MagicMatch {
  mimeType: string;
  isMkv: boolean;
}

/**
 * Read the first 12 bytes of a file to detect its type via magic bytes.
 * Returns null if the file cannot be identified as a supported video format.
 */
function detectMimeType(filePath: string): MagicMatch | null {
  const fd = openSync(filePath, 'r');
  const buf = Buffer.alloc(12);
  try {
    readSync(fd, buf, 0, 12, 0);
  } finally {
    closeSync(fd);
  }

  // MP4 / MOV / 3GPP — ftyp box at offset 4
  // Bytes 4–7 == 'ftyp'
  if (buf.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('ascii');
    if (brand.startsWith('qt  ')) {
      return { mimeType: 'video/quicktime', isMkv: false };
    }
    if (brand.startsWith('3gp') || brand.startsWith('3g2')) {
      return { mimeType: 'video/3gpp', isMkv: false };
    }
    // Default: treat all other ftyp brands as MP4
    return { mimeType: 'video/mp4', isMkv: false };
  }

  // WebM — starts with 1A 45 DF A3
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { mimeType: 'video/webm', isMkv: false };
  }

  // MKV — also starts with 1A 45 DF A3 (same EBML header as WebM)
  // We distinguish MKV from WebM by file extension (checked separately)

  // AVI — RIFF....AVI
  if (
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'AVI '
  ) {
    return { mimeType: 'video/x-msvideo', isMkv: false };
  }

  // MPEG-1/2 — starts with 00 00 01 Bx
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && (buf[3] & 0xf0) === 0xb0) {
    return { mimeType: 'video/mpeg', isMkv: false };
  }

  // FLV — starts with 'FLV'
  if (buf.slice(0, 3).toString('ascii') === 'FLV') {
    return { mimeType: 'video/x-flv', isMkv: false };
  }

  // WMV / ASF — starts with 30 26 B2 75
  if (buf[0] === 0x30 && buf[1] === 0x26 && buf[2] === 0xb2 && buf[3] === 0x75) {
    return { mimeType: 'video/x-ms-wmv', isMkv: false };
  }

  return null;
}

function isMkvFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.mkv') return true;

  // Also check matroska magic bytes: EBML header 1A 45 DF A3
  // then look for the DocType string "matroska" somewhere in the first ~64 bytes
  try {
    const fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(64);
    try {
      readSync(fd, buf, 0, 64, 0);
    } finally {
      closeSync(fd);
    }
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
      if (buf.toString('ascii').includes('matroska')) {
        return true;
      }
    }
  } catch {
    // ignore read errors — fall through
  }

  return false;
}

function fileSize(filePath: string): number {
  return statSync(filePath).size;
}

function tempPath(suffix: string): string {
  return join(tmpdir(), `vidistill-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
}

function tryUnlink(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // best-effort cleanup
  }
}

function ffmpegInstalled(): boolean {
  try {
    childProc.execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function convertMkvToMp4(inputPath: string): string {
  if (!ffmpegInstalled()) {
    throw new Error(
      'Cannot convert MKV: ffmpeg is not installed. Install ffmpeg: brew install ffmpeg',
    );
  }
  const output = tempPath('.mp4');
  try {
    childProc.execFileSync('ffmpeg', ['-i', inputPath, '-c', 'copy', output], { stdio: 'ignore' });
  } catch {
    tryUnlink(output);
    throw new Error('Failed to convert MKV to MP4. Ensure the file is not corrupted.');
  }
  return output;
}

function compressTo720p(inputPath: string): string {
  const output = tempPath('.mp4');
  log.info('Compressing video to 720p...');
  try {
    childProc.execFileSync(
      'ffmpeg',
      ['-i', inputPath, '-vf', 'scale=-2:720', '-c:a', 'copy', output],
      { stdio: 'ignore' },
    );
  } catch {
    tryUnlink(output);
    throw new Error('Failed to compress video. Ensure ffmpeg is installed: brew install ffmpeg');
  }
  return output;
}

export async function handleLocalFile(
  filePath: string,
  client: GeminiClient,
): Promise<LocalFileResult> {
  // 1. File existence
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  // 2. MKV detection (before MIME check so we can give a targeted error if ffmpeg missing)
  const isMkv = isMkvFile(filePath);

  // 3. MIME type via magic bytes (for non-MKV) — MKV has the EBML magic bytes shared with WebM
  if (!isMkv) {
    const match = detectMimeType(filePath);
    if (!match) {
      const ext = extname(filePath).toLowerCase();
      throw new Error(`Unsupported video format: ${ext || basename(filePath)}`);
    }
  }

  // 4. File size: reject > 3 GB
  const originalSize = fileSize(filePath);
  if (originalSize > SIZE_3GB) {
    throw new Error('File exceeds 3GB limit');
  }

  // Tracks temp files that must be cleaned up
  const tempFiles: string[] = [];

  try {
    let workingPath = filePath;

    // 5. Convert MKV → MP4
    if (isMkv) {
      const converted = convertMkvToMp4(workingPath);
      tempFiles.push(converted);
      workingPath = converted;
    }

    // 6. Compress if > 2 GB
    if (fileSize(workingPath) > SIZE_2GB) {
      const compressed = compressTo720p(workingPath);
      tempFiles.push(compressed);
      workingPath = compressed;

      if (fileSize(workingPath) > SIZE_2GB) {
        throw new Error(
          'File is still larger than 2GB after compression. Cannot upload.',
        );
      }
    }

    // 7. Upload
    const uploaded: UploadedFile = await client.uploadFile(workingPath);

    return {
      fileUri: uploaded.uri,
      mimeType: uploaded.mimeType,
      duration: uploaded.duration,
      uploadedFileName: uploaded.name,
    };
  } finally {
    for (const f of tempFiles) {
      tryUnlink(f);
    }
  }
}
