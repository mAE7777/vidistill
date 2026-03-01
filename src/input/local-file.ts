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
  isAudio: boolean;
}

interface MagicMatch {
  mimeType: string;
  isMkv: boolean;
}

/**
 * Read the first 12 bytes of a file to detect its type via magic bytes.
 * Returns null if the file cannot be identified as a supported video/audio format.
 */
function detectMimeType(filePath: string): MagicMatch | null {
  const fd = openSync(filePath, 'r');
  const buf = Buffer.alloc(12);
  try {
    readSync(fd, buf, 0, 12, 0);
  } finally {
    closeSync(fd);
  }

  // --- Audio formats (checked first) ---

  // MP3 with ID3 tag — bytes 0-2 == 'ID3'
  if (buf.slice(0, 3).toString('ascii') === 'ID3') {
    return { mimeType: 'audio/mp3', isMkv: false };
  }

  // AAC ADTS — 0xFFF sync + layer bits == 00 (distinguishes from MPEG audio)
  // MPEG-4 AAC: 0xF0/0xF1, MPEG-2 AAC: 0xF8/0xF9
  if (buf[0] === 0xff && (buf[1] & 0xf0) === 0xf0 && (buf[1] & 0x06) === 0x00) {
    return { mimeType: 'audio/aac', isMkv: false };
  }

  // MP3 / MPEG audio sync — byte 0 == 0xFF, byte 1 bits 7-5 == 111, layer != 00
  // Covers all MPEG audio layer variants (0xFB, 0xF3, 0xF2, 0xFA, etc.)
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0x00) {
    return { mimeType: 'audio/mp3', isMkv: false };
  }

  // FLAC — bytes 0-3 == 'fLaC'
  if (buf.slice(0, 4).toString('ascii') === 'fLaC') {
    return { mimeType: 'audio/flac', isMkv: false };
  }

  // OGG — bytes 0-3 == 'OggS'
  if (buf.slice(0, 4).toString('ascii') === 'OggS') {
    return { mimeType: 'audio/ogg', isMkv: false };
  }

  // WAV — bytes 0-3 == 'RIFF' AND bytes 8-11 == 'WAVE'
  if (
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WAVE'
  ) {
    return { mimeType: 'audio/wav', isMkv: false };
  }

  // --- Video formats ---

  // MP4 / MOV / 3GPP / M4A — ftyp box at offset 4
  // Bytes 4–7 == 'ftyp'
  if (buf.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('ascii');
    // M4A and M4B specific brands
    if (brand === 'M4A ' || brand === 'M4B ') {
      return { mimeType: 'audio/mp4', isMkv: false };
    }
    if (brand.startsWith('qt  ')) {
      return { mimeType: 'video/quicktime', isMkv: false };
    }
    if (brand.startsWith('3gp') || brand.startsWith('3g2')) {
      return { mimeType: 'video/3gpp', isMkv: false };
    }
    // Ambiguous brands: check file extension for .m4a/.m4b
    const ext = extname(filePath).toLowerCase();
    if (ext === '.m4a' || ext === '.m4b') {
      return { mimeType: 'audio/mp4', isMkv: false };
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

  // 2. MIME type via magic bytes — detect audio before MKV/video checks
  const mimeMatch = detectMimeType(filePath);
  const isAudio = mimeMatch != null && mimeMatch.mimeType.startsWith('audio/');

  // 3. MKV detection (only relevant for video files)
  const isMkv = !isAudio && isMkvFile(filePath);

  // 4. Validate format: non-audio, non-MKV files must match a known video format
  if (!isAudio && !isMkv && !mimeMatch) {
    const ext = extname(filePath).toLowerCase();
    throw new Error(`Unsupported video format: ${ext || basename(filePath)}`);
  }

  // 5. File size: reject > 3 GB
  const originalSize = fileSize(filePath);
  if (originalSize > SIZE_3GB) {
    throw new Error('File exceeds 3GB limit');
  }

  // Tracks temp files that must be cleaned up
  const tempFiles: string[] = [];

  try {
    let workingPath = filePath;

    // 6. Convert MKV → MP4 (video only)
    if (isMkv) {
      const converted = convertMkvToMp4(workingPath);
      tempFiles.push(converted);
      workingPath = converted;
    }

    // 7. Compress if > 2 GB (video only — audio files skip compression)
    if (!isAudio && fileSize(workingPath) > SIZE_2GB) {
      const compressed = compressTo720p(workingPath);
      tempFiles.push(compressed);
      workingPath = compressed;

      if (fileSize(workingPath) > SIZE_2GB) {
        throw new Error(
          'File is still larger than 2GB after compression. Cannot upload.',
        );
      }
    }

    // 8. Upload
    const uploaded: UploadedFile = await client.uploadFile(workingPath);

    return {
      fileUri: uploaded.uri,
      mimeType: uploaded.mimeType,
      duration: uploaded.duration,
      uploadedFileName: uploaded.name,
      isAudio,
    };
  } finally {
    for (const f of tempFiles) {
      tryUnlink(f);
    }
  }
}
