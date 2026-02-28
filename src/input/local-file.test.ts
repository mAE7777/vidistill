import { describe, it, expect, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before importing the module under test.
// Using vi.mock with static factories so Vitest can hoist them correctly.
//
// fs: mock the stat/file-read primitives so we can control file sizes and
//     magic-byte content without needing real large files.
//
// child_process: mock as a namespace object so `childProc.execFileSync` in
//     local-file.ts is interceptable (named import interception is unreliable
//     for Node built-ins in ESM; namespace property interception works).
// ---------------------------------------------------------------------------
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    statSync: vi.fn(),
    openSync: vi.fn(),
    readSync: vi.fn(),
    closeSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

import { handleLocalFile } from './local-file.js';
import type { GeminiClient, UploadedFile } from '../gemini/client.js';
import * as fs from 'fs';
import * as childProcess from 'child_process';

// ---------------------------------------------------------------------------
// Constants & magic-byte helpers
// ---------------------------------------------------------------------------
const GB = 1024 * 1024 * 1024;

function ftypBuf(brand: string): Buffer {
  const b = Buffer.alloc(12, 0);
  b.write('ftyp', 4, 'ascii');
  b.write(brand.padEnd(4, ' '), 8, 'ascii');
  return b;
}

const MAGIC = {
  mp4: ftypBuf('isom'),
  mov: ftypBuf('qt  '),
  '3gp': ftypBuf('3gpp'),
  webm: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]),
  avi: (() => {
    const b = Buffer.alloc(12, 0);
    b.write('RIFF', 0, 'ascii');
    b.write('AVI ', 8, 'ascii');
    return b;
  })(),
  mpeg: Buffer.from([0x00, 0x00, 0x01, 0xb3, 0, 0, 0, 0, 0, 0, 0, 0]),
  flv: Buffer.from([0x46, 0x4c, 0x56, 0x01, 0, 0, 0, 0, 0, 0, 0, 0]),
  wmv: Buffer.from([0x30, 0x26, 0xb2, 0x75, 0, 0, 0, 0, 0, 0, 0, 0]),
  txt: Buffer.from('hello world!', 'ascii'),
};

// Matroska EBML header + 'matroska' doctype string padded to 64 bytes
const MKV_MAGIC = (() => {
  const b = Buffer.alloc(64, 0);
  b[0] = 0x1a; b[1] = 0x45; b[2] = 0xdf; b[3] = 0xa3;
  b.write('matroska', 20, 'ascii');
  return b;
})();

// ---------------------------------------------------------------------------
// Upload client mock
// ---------------------------------------------------------------------------
const UPLOADED: UploadedFile = {
  uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc',
  mimeType: 'video/mp4',
  name: 'files/abc',
  duration: 120,
};

const mockUploadFile = vi.fn<(p: string) => Promise<UploadedFile>>();
const mockClient = { uploadFile: mockUploadFile } as unknown as GeminiClient;

// ---------------------------------------------------------------------------
// Typed mock accessors
// ---------------------------------------------------------------------------
function execMock(): ReturnType<typeof vi.fn> {
  return childProcess.execFileSync as ReturnType<typeof vi.fn>;
}

function statMock(): ReturnType<typeof vi.fn> {
  return fs.statSync as ReturnType<typeof vi.fn>;
}

function openMock(): ReturnType<typeof vi.fn> {
  return fs.openSync as ReturnType<typeof vi.fn>;
}

function readMock(): ReturnType<typeof vi.fn> {
  return fs.readSync as ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
// Helper: set up fs mocks for a file with given magic bytes and stat sizes.
// sizes: list of sizes returned by statSync in sequence.
// ---------------------------------------------------------------------------
function setupFsMocks(magicBuf: Buffer, sizes: number[]): void {
  (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

  // Set up statSync to return sizes in sequence. We use a custom implementation
  // with a closure counter because mockReturnValueOnce queuing may not work
  // reliably across module boundaries in Vitest ESM.
  let sizeIndex = 0;
  const sizeCopy = [...sizes];
  statMock().mockImplementation(() => {
    const s = sizeCopy[sizeIndex] ?? sizeCopy[sizeCopy.length - 1] ?? 0;
    sizeIndex++;
    return { size: s } as fs.Stats;
  });

  openMock().mockReturnValue(3);
  readMock().mockImplementation(
    (_fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number) => {
      const buf = buffer as Buffer;
      const n = Math.min(length, magicBuf.length);
      magicBuf.copy(buf, offset, 0, n);
      return n;
    },
  );
  (fs.closeSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
  (fs.unlinkSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
afterEach(() => {
  vi.clearAllMocks();
  mockUploadFile.mockResolvedValue(UPLOADED);
  execMock().mockReturnValue(Buffer.from(''));
});

// Set defaults before first test
mockUploadFile.mockResolvedValue(UPLOADED);
execMock().mockReturnValue(Buffer.from(''));

// ---------------------------------------------------------------------------
// AC 1: valid MP4 under 2GB — uploads directly without compression
// ---------------------------------------------------------------------------
describe('AC 1: valid MP4 under 2GB', () => {
  it('uploads directly without invoking ffmpeg compress', async () => {
    // statSync called twice: once for 3GB check, once for 2GB check
    setupFsMocks(MAGIC.mp4, [1 * GB, 1 * GB]);

    const result = await handleLocalFile('/videos/video.mp4', mockClient);

    const calls = execMock().mock.calls as [string, string[]][];
    const compressCalls = calls.filter(
      c => Array.isArray(c[1]) && c[1].includes('scale=-2:720'),
    );
    expect(compressCalls).toHaveLength(0);

    expect(mockUploadFile).toHaveBeenCalledWith('/videos/video.mp4');
    expect(result.fileUri).toBe(UPLOADED.uri);
    expect(result.mimeType).toBe(UPLOADED.mimeType);
    expect(result.duration).toBe(UPLOADED.duration);
  });
});

// ---------------------------------------------------------------------------
// AC 2: large MP4 (2.5 GB) — compresses to 720p first, then uploads
// statSync is called twice: once for the original (returns 2.5GB) and once
// for the compressed output (returns 1GB).
// ---------------------------------------------------------------------------
describe('AC 2: large MP4 > 2GB compresses to 720p', () => {
  it('calls ffmpeg with scale=-2:720 then uploads the compressed path', async () => {
    // statSync calls:
    //   #1 → fileSize(original) for 3GB check → 2.5GB
    //   #2 → fileSize(workingPath) for 2GB check → 2.5GB (triggers compression)
    //   #3 → fileSize(compressed) for post-compression 2GB check → 1GB
    setupFsMocks(MAGIC.mp4, [2.5 * GB, 2.5 * GB, 1 * GB]);

    const result = await handleLocalFile('/videos/large.mp4', mockClient);

    const calls = execMock().mock.calls as [string, string[]][];
    const compressCalls = calls.filter(
      c => Array.isArray(c[1]) && c[1].includes('scale=-2:720'),
    );
    expect(compressCalls).toHaveLength(1);

    // Upload should use a temp file path (not the original)
    expect(mockUploadFile).toHaveBeenCalledOnce();
    const uploadedPath = mockUploadFile.mock.calls[0][0];
    expect(uploadedPath).not.toBe('/videos/large.mp4');
    expect(result.fileUri).toBe(UPLOADED.uri);
  });
});

// ---------------------------------------------------------------------------
// AC 3: file > 3GB — throws "File exceeds 3GB limit"
// ---------------------------------------------------------------------------
describe('AC 3: file > 3GB', () => {
  it('throws File exceeds 3GB limit', async () => {
    setupFsMocks(MAGIC.mp4, [3.1 * GB]);

    await expect(handleLocalFile('/videos/huge.mp4', mockClient)).rejects.toThrow(
      'File exceeds 3GB limit',
    );
    expect(mockUploadFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC 4: MKV file — converts to MP4 first, then uploads
// statSync is called once after conversion to check if compressed (returns small).
// ---------------------------------------------------------------------------
describe('AC 4: MKV file converts to MP4 first', () => {
  it('calls ffmpeg -c copy then uploads a .mp4 temp file', async () => {
    // MKV path: isMkvFile() returns true via .mkv extension — no statSync yet.
    // Then: fileSize(workingPath=original.mkv) → statSync #1 (size check < 3GB)
    // Then: convertMkvToMp4 runs → ffmpegInstalled() checks with execFileSync
    //       then conversion execFileSync
    // Then: fileSize(convertedPath) → statSync #2 (check if > 2GB)
    setupFsMocks(MKV_MAGIC, [500 * 1024 * 1024, 400 * 1024 * 1024]);

    const result = await handleLocalFile('/videos/movie.mkv', mockClient);

    const calls = execMock().mock.calls as [string, string[]][];
    const convertCalls = calls.filter(
      c => Array.isArray(c[1]) && c[1].includes('-c') && c[1].includes('copy'),
    );
    expect(convertCalls).toHaveLength(1);

    expect(mockUploadFile).toHaveBeenCalledOnce();
    const uploadedPath = mockUploadFile.mock.calls[0][0];
    expect(uploadedPath).not.toBe('/videos/movie.mkv');
    expect(uploadedPath.endsWith('.mp4')).toBe(true);
    expect(result.fileUri).toBe(UPLOADED.uri);
  });
});

// ---------------------------------------------------------------------------
// AC 5: ffmpeg not installed + MKV — error includes "brew install ffmpeg"
// ---------------------------------------------------------------------------
describe('AC 5: ffmpeg not installed + MKV', () => {
  it('error message includes brew install ffmpeg', async () => {
    setupFsMocks(MKV_MAGIC, [500 * 1024 * 1024]);

    // All execFileSync calls throw — simulates missing ffmpeg
    execMock().mockImplementation(() => {
      throw new Error('command not found: ffmpeg');
    });

    await expect(handleLocalFile('/videos/movie.mkv', mockClient)).rejects.toThrow(
      'brew install ffmpeg',
    );
    expect(mockUploadFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC 6: .txt file — rejects with "Unsupported video format"
// ---------------------------------------------------------------------------
describe('AC 6: .txt file rejected', () => {
  it('throws Unsupported video format', async () => {
    setupFsMocks(MAGIC.txt, [1024]);

    await expect(handleLocalFile('/documents/notes.txt', mockClient)).rejects.toThrow(
      'Unsupported video format',
    );
    expect(mockUploadFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Extra: temp files cleaned up after successful MKV conversion
// ---------------------------------------------------------------------------
describe('temp file cleanup', () => {
  it('calls unlinkSync on the converted temp file', async () => {
    setupFsMocks(MKV_MAGIC, [500 * 1024 * 1024, 400 * 1024 * 1024]);

    await handleLocalFile('/videos/movie.mkv', mockClient);

    expect(fs.unlinkSync as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    // The path cleaned up should be the temp .mp4, not the original .mkv
    const unlinkCalls = (fs.unlinkSync as ReturnType<typeof vi.fn>).mock.calls as string[][];
    const cleanedPaths = unlinkCalls.map(c => c[0]);
    expect(cleanedPaths.some((p: string) => p.endsWith('.mp4'))).toBe(true);
  });
});
