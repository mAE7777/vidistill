import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Pass2Result } from '../types/index.js';

// Mock fs and child_process before importing the module under test
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

import { existsSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { extractKeyframes } from './keyframes.js';

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockExecFileSync = vi.mocked(execFileSync);

afterEach(() => vi.resetAllMocks());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePass2(
  screenTimeline: { timestamp: string; screen_state: string }[],
  visualNotes: { timestamp: string; visual_type: string; description: string }[] = [],
): Pass2Result {
  return {
    segment_index: 0,
    time_range: '0-600',
    code_blocks: [],
    visual_notes: visualNotes,
    screen_timeline: screenTimeline,
  };
}

// ---------------------------------------------------------------------------
// AC: YouTube direct URL → empty result without error
// ---------------------------------------------------------------------------

describe('YouTube URL handling', () => {
  it('returns empty result when filePath is an http URL', async () => {
    const result = await extractKeyframes({
      filePath: 'https://youtube.com/watch?v=abc123',
      pass2Results: [],
      outputDir: '/out',
    });

    expect(result.frames).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('returns empty result when filePath is empty string', async () => {
    const result = await extractKeyframes({
      filePath: '',
      pass2Results: [],
      outputDir: '/out',
    });

    expect(result.frames).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('returns empty result when filePath does not exist on disk', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await extractKeyframes({
      filePath: '/no/such/file.mp4',
      pass2Results: [],
      outputDir: '/out',
    });

    expect(result.frames).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC: slide change at "00:05:30" → images/frame-00-05-30.png
// ---------------------------------------------------------------------------

describe('frame filename generation', () => {
  it('creates frame-00-05-30.png for a slide change at 00:05:30', async () => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockImplementation(() => undefined);
    mockExecFileSync.mockImplementation(() => Buffer.from(''));

    const pass2 = makePass2(
      [
        { timestamp: '00:00:00', screen_state: 'blank' },
        { timestamp: '00:05:30', screen_state: 'slide: introduction' },
      ],
    );

    const result = await extractKeyframes({
      filePath: '/video.mp4',
      pass2Results: [pass2],
      outputDir: '/out',
    });

    expect(result.frames).toHaveLength(2);
    const frame = result.frames.find((f) => f.timestamp === '00:05:30');
    expect(frame).toBeDefined();
    expect(frame?.path).toMatch(/frame-00-05-30\.png$/);
  });
});

// ---------------------------------------------------------------------------
// AC: 80 timestamps + maxFrames:50 → exactly 50 frames evenly distributed
// ---------------------------------------------------------------------------

describe('maxFrames sampling', () => {
  it('extracts exactly 50 frames when 80 significant timestamps exist', async () => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockImplementation(() => undefined);
    mockExecFileSync.mockImplementation(() => Buffer.from(''));

    // Build 80 screen state changes, one every 30 seconds
    const timeline: { timestamp: string; screen_state: string }[] = [];
    for (let i = 0; i < 80; i++) {
      const secs = i * 30;
      const h = String(Math.floor(secs / 3600)).padStart(2, '0');
      const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
      const s = String(secs % 60).padStart(2, '0');
      timeline.push({ timestamp: `${h}:${m}:${s}`, screen_state: `slide-${i}` });
    }

    const pass2 = makePass2(timeline);

    const result = await extractKeyframes({
      filePath: '/video.mp4',
      pass2Results: [pass2],
      maxFrames: 50,
      outputDir: '/out',
    });

    expect(result.frames).toHaveLength(50);
    expect(result.errors).toHaveLength(0);
  });

  it('extracts all frames when count is below maxFrames', async () => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockImplementation(() => undefined);
    mockExecFileSync.mockImplementation(() => Buffer.from(''));

    const timeline = [
      { timestamp: '00:01:00', screen_state: 'slide-a' },
      { timestamp: '00:02:00', screen_state: 'slide-b' },
      { timestamp: '00:03:00', screen_state: 'slide-c' },
    ];

    const pass2 = makePass2(timeline);

    const result = await extractKeyframes({
      filePath: '/video.mp4',
      pass2Results: [pass2],
      maxFrames: 50,
      outputDir: '/out',
    });

    expect(result.frames).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// AC: deduplication within 3-second window
// ---------------------------------------------------------------------------

describe('deduplication', () => {
  it('keeps only the earliest of two changes within 3 seconds', async () => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockImplementation(() => undefined);
    mockExecFileSync.mockImplementation(() => Buffer.from(''));

    const pass2 = makePass2(
      [
        { timestamp: '00:10:00', screen_state: 'slide-a' },
        { timestamp: '00:10:02', screen_state: 'slide-b' },
      ],
    );

    const result = await extractKeyframes({
      filePath: '/video.mp4',
      pass2Results: [pass2],
      outputDir: '/out',
    });

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0].timestamp).toBe('00:10:00');
  });

  it('keeps both changes when they are exactly 3 seconds apart', async () => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockImplementation(() => undefined);
    mockExecFileSync.mockImplementation(() => Buffer.from(''));

    const pass2 = makePass2(
      [
        { timestamp: '00:10:00', screen_state: 'slide-a' },
        { timestamp: '00:10:03', screen_state: 'slide-b' },
      ],
    );

    const result = await extractKeyframes({
      filePath: '/video.mp4',
      pass2Results: [pass2],
      outputDir: '/out',
    });

    expect(result.frames).toHaveLength(2);
  });

  it('keeps changes more than 3 seconds apart', async () => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockImplementation(() => undefined);
    mockExecFileSync.mockImplementation(() => Buffer.from(''));

    const pass2 = makePass2(
      [
        { timestamp: '00:10:00', screen_state: 'slide-a' },
        { timestamp: '00:10:05', screen_state: 'slide-b' },
      ],
    );

    const result = await extractKeyframes({
      filePath: '/video.mp4',
      pass2Results: [pass2],
      outputDir: '/out',
    });

    expect(result.frames).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// AC: ffmpeg failure for one frame → error recorded, other frames extracted
// ---------------------------------------------------------------------------

describe('ffmpeg error handling', () => {
  it('records error and continues extracting remaining frames when one fails', async () => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockImplementation(() => undefined);

    let callCount = 0;
    mockExecFileSync.mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        throw new Error('ffmpeg: No such file or directory');
      }
      return Buffer.from('');
    });

    const pass2 = makePass2([
      { timestamp: '00:01:00', screen_state: 'slide-a' },
      { timestamp: '00:05:00', screen_state: 'slide-b' },
      { timestamp: '00:09:00', screen_state: 'slide-c' },
    ]);

    const result = await extractKeyframes({
      filePath: '/video.mp4',
      pass2Results: [pass2],
      outputDir: '/out',
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('00:05:00');
    expect(result.frames).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Description resolution
// ---------------------------------------------------------------------------

describe('frame description', () => {
  it('uses the nearest visual_notes description when available', async () => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockImplementation(() => undefined);
    mockExecFileSync.mockImplementation(() => Buffer.from(''));

    const pass2 = makePass2(
      [{ timestamp: '00:05:00', screen_state: 'terminal' }],
      [{ timestamp: '00:05:01', visual_type: 'slide', description: 'React hooks overview' }],
    );

    const result = await extractKeyframes({
      filePath: '/video.mp4',
      pass2Results: [pass2],
      outputDir: '/out',
    });

    expect(result.frames[0].description).toBe('React hooks overview');
  });

  it('falls back to screen_state when no visual_notes entry exists', async () => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockImplementation(() => undefined);
    mockExecFileSync.mockImplementation(() => Buffer.from(''));

    const pass2 = makePass2([
      { timestamp: '00:05:00', screen_state: 'code editor: main.ts' },
    ]);

    const result = await extractKeyframes({
      filePath: '/video.mp4',
      pass2Results: [pass2],
      outputDir: '/out',
    });

    expect(result.frames[0].description).toBe('code editor: main.ts');
  });

  it('collects visual_notes of type slide, diagram, and whiteboard', async () => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockImplementation(() => undefined);
    mockExecFileSync.mockImplementation(() => Buffer.from(''));

    const pass2 = makePass2(
      [],
      [
        { timestamp: '00:01:00', visual_type: 'slide', description: 'Slide 1' },
        { timestamp: '00:02:00', visual_type: 'diagram', description: 'Architecture diagram' },
        { timestamp: '00:03:00', visual_type: 'whiteboard', description: 'Whiteboard sketch' },
        { timestamp: '00:04:00', visual_type: 'code', description: 'Code snippet' }, // excluded
      ],
    );

    const result = await extractKeyframes({
      filePath: '/video.mp4',
      pass2Results: [pass2],
      outputDir: '/out',
    });

    // Only slide, diagram, whiteboard → 3 frames
    expect(result.frames).toHaveLength(3);
    expect(result.frames.map((f) => f.description)).toEqual([
      'Slide 1',
      'Architecture diagram',
      'Whiteboard sketch',
    ]);
  });
});

// ---------------------------------------------------------------------------
// ffmpeg call shape
// ---------------------------------------------------------------------------

describe('ffmpeg invocation', () => {
  it('calls execFileSync with -ss before -i for fast seeking', async () => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockImplementation(() => undefined);
    mockExecFileSync.mockImplementation(() => Buffer.from(''));

    const pass2 = makePass2([
      { timestamp: '00:05:30', screen_state: 'slide' },
    ]);

    await extractKeyframes({
      filePath: '/video.mp4',
      pass2Results: [pass2],
      outputDir: '/out',
    });

    expect(mockExecFileSync).toHaveBeenCalledWith('ffmpeg', [
      '-y',
      '-ss', '00:05:30',
      '-i', '/video.mp4',
      '-frames:v', '1',
      '-q:v', '2',
      expect.stringMatching(/frame-00-05-30\.png$/),
    ]);
  });

  it('creates images/ subdirectory inside outputDir', async () => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockImplementation(() => undefined);
    mockExecFileSync.mockImplementation(() => Buffer.from(''));

    const pass2 = makePass2([
      { timestamp: '00:01:00', screen_state: 'slide' },
    ]);

    await extractKeyframes({
      filePath: '/video.mp4',
      pass2Results: [pass2],
      outputDir: '/out/session',
    });

    expect(mockMkdirSync).toHaveBeenCalledWith('/out/session/images', { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// Null pass2Results entries
// ---------------------------------------------------------------------------

describe('null pass2Results entries', () => {
  it('gracefully skips null entries in pass2Results', async () => {
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockImplementation(() => undefined);
    mockExecFileSync.mockImplementation(() => Buffer.from(''));

    const pass2 = makePass2([
      { timestamp: '00:01:00', screen_state: 'slide-a' },
    ]);

    const result = await extractKeyframes({
      filePath: '/video.mp4',
      pass2Results: [null, pass2, null],
      outputDir: '/out',
    });

    expect(result.frames).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });
});
