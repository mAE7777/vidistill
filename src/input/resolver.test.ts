import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

import { existsSync } from 'fs';
import { resolveInput } from './resolver.js';

const mockExistsSync = vi.mocked(existsSync);

afterEach(() => {
  vi.resetAllMocks();
});

describe('resolveInput', () => {
  it('resolves a standard YouTube URL to type youtube', () => {
    const result = resolveInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.type).toBe('youtube');
    expect(result.value).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('resolves a youtu.be short URL to type youtube', () => {
    const result = resolveInput('https://youtu.be/dQw4w9WgXcQ');
    expect(result.type).toBe('youtube');
    expect(result.value).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('resolves a local file path when file exists', () => {
    mockExistsSync.mockReturnValue(true);
    const result = resolveInput('/path/to/video.mp4');
    expect(result.type).toBe('local');
    expect(result.value).toBe('/path/to/video.mp4');
  });

  it('throws for a non-YouTube URL', () => {
    expect(() => resolveInput('https://vimeo.com/123456')).toThrow(
      'Invalid URL. Only YouTube URLs are supported.',
    );
  });

  it('throws for a nonexistent local file', () => {
    mockExistsSync.mockReturnValue(false);
    expect(() => resolveInput('/path/to/missing.mp4')).toThrow('File not found: /path/to/missing.mp4');
  });

  it('trims whitespace from input before resolving', () => {
    mockExistsSync.mockReturnValue(true);
    const result = resolveInput('  /path/to/video.mp4  ');
    expect(result.type).toBe('local');
    expect(result.value).toBe('/path/to/video.mp4');
    expect(mockExistsSync).toHaveBeenCalledWith('/path/to/video.mp4');
  });

  it('trims whitespace from YouTube URLs', () => {
    const result = resolveInput('  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ');
    expect(result.type).toBe('youtube');
  });

  it('throws for an empty string after trimming', () => {
    mockExistsSync.mockReturnValue(false);
    expect(() => resolveInput('   ')).toThrow('File not found:');
  });
});
