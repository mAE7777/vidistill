import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — declared before importing the module under test.
// vi.hoisted() is required for variables referenced in vi.mock() factories,
// since vi.mock() calls are hoisted to the top of the file by Vitest.
// ---------------------------------------------------------------------------

const {
  mockExecFileSync,
  mockGetInfoAsync,
  mockDownloadAsync,
  mockTryUnlink,
  mockUploadFile,
  MockYtDlp,
} = vi.hoisted(() => {
  const mockExecFileSync = vi.fn();
  const mockGetInfoAsync = vi.fn();
  const mockDownloadAsync = vi.fn();
  const mockTryUnlink = vi.fn();
  const mockUploadFile = vi.fn();

  const MockYtDlp = vi.fn().mockImplementation(() => ({
    getInfoAsync: mockGetInfoAsync,
    downloadAsync: mockDownloadAsync,
  }));

  return {
    mockExecFileSync,
    mockGetInfoAsync,
    mockDownloadAsync,
    mockTryUnlink,
    mockUploadFile,
    MockYtDlp,
  };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFileSync: mockExecFileSync };
});

vi.mock('ytdlp-nodejs', () => ({
  YtDlp: MockYtDlp,
}));

vi.mock('./local-file.js', () => ({
  tryUnlink: mockTryUnlink,
}));

import { handleRemoteUrl } from './remote.js';
import type { GeminiClient } from '../gemini/client.js';

afterEach(() => {
  vi.resetAllMocks();
});

beforeEach(() => {
  // Re-apply mockImplementation after resetAllMocks clears it
  MockYtDlp.mockImplementation(() => ({
    getInfoAsync: mockGetInfoAsync,
    downloadAsync: mockDownloadAsync,
  }));
  // Default: yt-dlp is installed
  mockExecFileSync.mockReturnValue('/opt/homebrew/bin/yt-dlp\n');
});

function makeClient(): GeminiClient {
  return { uploadFile: mockUploadFile } as unknown as GeminiClient;
}

describe('handleRemoteUrl', () => {
  it('throws with install instructions when yt-dlp is not installed', async () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('not found'); });

    await expect(handleRemoteUrl('https://vimeo.com/123456', makeClient())).rejects.toThrow(
      'yt-dlp is required for non-YouTube URLs. Install: brew install yt-dlp',
    );
  });

  it('downloads, uploads, deletes temp file, and returns result', async () => {
    mockGetInfoAsync.mockResolvedValue({ title: 'Test Video', duration: 120 });
    mockDownloadAsync.mockResolvedValue('');
    mockUploadFile.mockResolvedValue({
      uri: 'https://gemini/file/abc123',
      mimeType: 'video/mp4',
      duration: 120,
      name: 'files/abc123',
    });

    const result = await handleRemoteUrl('https://vimeo.com/123456', makeClient());

    expect(result.fileUri).toBe('https://gemini/file/abc123');
    expect(result.mimeType).toBe('video/mp4');
    expect(result.duration).toBe(120);
    expect(result.title).toBe('Test Video');
    expect(result.uploadedFileName).toBe('files/abc123');

    // temp file must have been cleaned up
    expect(mockTryUnlink).toHaveBeenCalledOnce();
  });

  it('deletes temp file even when upload fails', async () => {
    mockGetInfoAsync.mockResolvedValue({ title: 'Test Video', duration: 60 });
    mockDownloadAsync.mockResolvedValue('');
    mockUploadFile.mockRejectedValue(new Error('upload failed'));

    await expect(handleRemoteUrl('https://vimeo.com/123456', makeClient())).rejects.toThrow(
      'upload failed',
    );

    // temp file must still have been cleaned up
    expect(mockTryUnlink).toHaveBeenCalledOnce();
  });

  it('uses URL as title fallback when metadata fetch fails', async () => {
    mockGetInfoAsync.mockRejectedValue(new Error('metadata unavailable'));
    mockDownloadAsync.mockResolvedValue('');
    mockUploadFile.mockResolvedValue({
      uri: 'https://gemini/file/abc123',
      mimeType: 'video/mp4',
      duration: undefined,
      name: 'files/abc123',
    });

    const result = await handleRemoteUrl('https://vimeo.com/123456', makeClient());

    expect(result.title).toBe('https://vimeo.com/123456');
  });

  it('propagates download failure as fatal error', async () => {
    mockGetInfoAsync.mockResolvedValue({ title: 'Test Video', duration: 60 });
    mockDownloadAsync.mockRejectedValue(new Error('yt-dlp exited with code 1'));

    await expect(handleRemoteUrl('https://vimeo.com/123456', makeClient())).rejects.toThrow(
      'yt-dlp exited with code 1',
    );

    expect(mockTryUnlink).toHaveBeenCalledOnce();
  });
});
