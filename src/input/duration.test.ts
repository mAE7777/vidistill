import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — declared before importing the module under test so Vitest
// can hoist them correctly.
//
// fluent-ffmpeg is loaded via createRequire inside duration.ts.
// We intercept the module resolution by mocking the entire 'module' built-in
// so that createRequire returns a factory that yields our mock object.
//
// @clack/prompts: mock `log.warn` to capture warning messages.
// fs: mock statSync for the file-size fallback path.
//
// Variables used inside vi.mock factories must be created with vi.hoisted()
// because vi.mock calls are hoisted to the top of the file by Vitest.
// ---------------------------------------------------------------------------

const { mockFfprobe, mockLogWarn } = vi.hoisted(() => ({
  mockFfprobe: vi.fn(),
  mockLogWarn: vi.fn(),
}));

vi.mock('module', async () => {
  const actual = await vi.importActual<typeof import('module')>('module');
  return {
    ...actual,
    createRequire: () => (id: string) => {
      if (id === 'fluent-ffmpeg') {
        return { ffprobe: mockFfprobe };
      }
      // delegate everything else to the real require via the actual createRequire
      return actual.createRequire(import.meta.url)(id);
    },
  };
});

vi.mock('@clack/prompts', async () => {
  const actual = await vi.importActual<typeof import('@clack/prompts')>('@clack/prompts');
  return {
    ...actual,
    log: {
      ...(actual as { log?: Record<string, unknown> }).log,
      warn: mockLogWarn,
    },
  };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    statSync: vi.fn(),
  };
});

import { detectDuration } from './duration.js';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make mockFfprobe call back with a successful FfprobeData result */
function ffprobeSuccess(durationSeconds: number): void {
  mockFfprobe.mockImplementation(
    (_file: string, callback: (err: null, data: { format: { duration: number } }) => void) => {
      callback(null, { format: { duration: durationSeconds } });
    },
  );
}

/** Make mockFfprobe call back with an error */
function ffprobeError(message: string): void {
  mockFfprobe.mockImplementation(
    (_file: string, callback: (err: Error, data: null) => void) => {
      callback(new Error(message), null);
    },
  );
}

/** Make mockFfprobe simulate "ffprobe not installed" error */
function ffprobeNotFound(): void {
  ffprobeError('spawn ffprobe ENOENT');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('detectDuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // AC 1: Local file + ffprobe installed → accurate duration via ffprobe
  // -------------------------------------------------------------------------
  describe('AC 1: local file with ffprobe available', () => {
    it('returns accurate duration from ffprobe', async () => {
      ffprobeSuccess(3723.5); // 1h 2m 3.5s

      const duration = await detectDuration({ filePath: '/path/to/video.mp4' });

      expect(duration).toBe(3723.5);
      expect(mockFfprobe).toHaveBeenCalledWith('/path/to/video.mp4', expect.any(Function));
      expect(mockLogWarn).not.toHaveBeenCalled();
    });

    it('passes the exact file path to ffprobe', async () => {
      ffprobeSuccess(60);

      await detectDuration({ filePath: '/some/other/path/video.mkv' });

      expect(mockFfprobe).toHaveBeenCalledWith('/some/other/path/video.mkv', expect.any(Function));
    });

    it('returns 0 duration correctly', async () => {
      ffprobeSuccess(0);

      const duration = await detectDuration({ filePath: '/path/to/video.mp4' });

      // 0 is a valid number from ffprobe — return as-is
      expect(duration).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // AC 2: ffprobe not installed → file size estimation + warning
  // -------------------------------------------------------------------------
  describe('AC 2: ffprobe not installed', () => {
    it('falls back to file size estimation and warns when ffprobe not found', async () => {
      ffprobeNotFound();
      vi.mocked(fs.statSync).mockReturnValue({ size: 5_000_000 } as ReturnType<typeof fs.statSync>);

      const duration = await detectDuration({ filePath: '/path/to/video.mp4' });

      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringContaining('ffprobe not found'),
      );
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringContaining('brew install ffmpeg'),
      );
      // 5_000_000 / 500_000 = 10 seconds
      expect(duration).toBe(10);
    });

    it('warns about inaccurate segmentation when using file size estimate', async () => {
      ffprobeNotFound();
      vi.mocked(fs.statSync).mockReturnValue({ size: 1_000_000 } as ReturnType<typeof fs.statSync>);

      await detectDuration({ filePath: '/path/to/video.mp4' });

      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringContaining('Duration estimated from file size'),
      );
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringContaining('segmentation may be inaccurate'),
      );
    });

    it('also falls back to file size when ffprobe returns a generic error', async () => {
      ffprobeError('some unexpected ffprobe failure');
      vi.mocked(fs.statSync).mockReturnValue({ size: 2_000_000 } as ReturnType<typeof fs.statSync>);

      const duration = await detectDuration({ filePath: '/path/to/video.mp4' });

      // 2_000_000 / 500_000 = 4 seconds
      expect(duration).toBe(4);
    });

    it('uses explicit fileSize when filePath statSync fails', async () => {
      ffprobeNotFound();
      vi.mocked(fs.statSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const duration = await detectDuration({
        filePath: '/missing/file.mp4',
        fileSize: 3_000_000,
      });

      // 3_000_000 / 500_000 = 6 seconds
      expect(duration).toBe(6);
    });
  });

  // -------------------------------------------------------------------------
  // AC 3: YouTube via yt-dlp → use yt-dlp duration metadata
  // -------------------------------------------------------------------------
  describe('AC 3: YouTube source with yt-dlp duration', () => {
    it('returns yt-dlp duration when no local file path is provided', async () => {
      const duration = await detectDuration({ ytDlpDuration: 1800 });

      expect(duration).toBe(1800);
      expect(mockFfprobe).not.toHaveBeenCalled();
      expect(mockLogWarn).not.toHaveBeenCalled();
    });

    it('does not call ffprobe when ytDlpDuration is available without filePath', async () => {
      await detectDuration({ ytDlpDuration: 300 });

      expect(mockFfprobe).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Gemini metadata path
  // -------------------------------------------------------------------------
  describe('Gemini metadata duration', () => {
    it('returns geminiDuration when ffprobe fails and no yt-dlp duration', async () => {
      ffprobeError('some error');

      const duration = await detectDuration({
        filePath: '/path/to/video.mp4',
        geminiDuration: 900,
      });

      expect(duration).toBe(900);
      expect(mockLogWarn).not.toHaveBeenCalledWith(
        expect.stringContaining('Duration estimated from file size'),
      );
    });

    it('uses geminiDuration for YouTube direct (no filePath, no yt-dlp)', async () => {
      const duration = await detectDuration({ geminiDuration: 600 });

      expect(duration).toBe(600);
      expect(mockFfprobe).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Priority order verification
  // -------------------------------------------------------------------------
  describe('fallback priority', () => {
    it('prefers ffprobe over geminiDuration when both are available', async () => {
      ffprobeSuccess(100);

      const duration = await detectDuration({
        filePath: '/path/to/video.mp4',
        geminiDuration: 999,
        ytDlpDuration: 888,
      });

      expect(duration).toBe(100); // ffprobe wins
    });

    it('prefers geminiDuration over ytDlpDuration when ffprobe fails', async () => {
      ffprobeError('error');

      const duration = await detectDuration({
        filePath: '/path/to/video.mp4',
        geminiDuration: 500,
        ytDlpDuration: 300,
      });

      expect(duration).toBe(500); // gemini wins over yt-dlp
    });

    it('prefers ytDlpDuration over file size estimate when geminiDuration is absent', async () => {
      ffprobeError('error');
      vi.mocked(fs.statSync).mockReturnValue({ size: 10_000_000 } as ReturnType<typeof fs.statSync>);

      const duration = await detectDuration({
        filePath: '/path/to/video.mp4',
        ytDlpDuration: 250,
      });

      expect(duration).toBe(250); // yt-dlp wins over file size estimate
    });
  });

  // -------------------------------------------------------------------------
  // File size estimation math
  // -------------------------------------------------------------------------
  describe('file size estimation', () => {
    it('estimates 1 second for very small files (rounds up from 0)', async () => {
      ffprobeNotFound();
      vi.mocked(fs.statSync).mockReturnValue({ size: 100 } as ReturnType<typeof fs.statSync>);

      const duration = await detectDuration({ filePath: '/tiny/file.mp4' });

      expect(duration).toBeGreaterThanOrEqual(1);
    });

    it('estimates duration as Math.round(fileSize / 500000)', async () => {
      ffprobeNotFound();
      // 1_250_000 / 500_000 = 2.5 → rounds to 3
      vi.mocked(fs.statSync).mockReturnValue({ size: 1_250_000 } as ReturnType<typeof fs.statSync>);

      const duration = await detectDuration({ filePath: '/path/to/video.mp4' });

      expect(duration).toBe(3);
    });

    it('uses explicit fileSize field when no filePath provided', async () => {
      const duration = await detectDuration({ fileSize: 5_000_000 });

      expect(duration).toBe(10);
      expect(mockFfprobe).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Error case: no usable source at all
  // -------------------------------------------------------------------------
  describe('no usable source', () => {
    it('throws when no source can provide a duration', async () => {
      await expect(detectDuration({})).rejects.toThrow(
        /unable to determine video duration/i,
      );
    });

    it('throws when all values are zero or undefined', async () => {
      await expect(
        detectDuration({ geminiDuration: 0, ytDlpDuration: 0, fileSize: 0 }),
      ).rejects.toThrow(/unable to determine video duration/i);
    });
  });
});
