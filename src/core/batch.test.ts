import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseBatchFile, generateBatchIndex } from './batch.js';
import type { BatchResult } from './batch.js';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { existsSync, readFileSync } from 'fs';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

afterEach(() => vi.resetAllMocks());

describe('parseBatchFile', () => {
  it('throws if the file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(() => parseBatchFile('/no/such/file.txt')).toThrow('Batch file not found: /no/such/file.txt');
  });

  it('returns empty array for a file with only comments and blank lines', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('# comment\n\n  \n# another comment\n' as unknown as ReturnType<typeof readFileSync>);
    expect(parseBatchFile('/some/file.txt')).toEqual([]);
  });

  it('parses plain URLs without context', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      'https://youtube.com/watch?v=abc\nhttps://example.com/video.mp4\n' as unknown as ReturnType<typeof readFileSync>,
    );
    expect(parseBatchFile('/batch.txt')).toEqual([
      { input: 'https://youtube.com/watch?v=abc' },
      { input: 'https://example.com/video.mp4' },
    ]);
  });

  it('parses a line with pipe separator into input + context', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('https://youtube.com/watch?v=abc|CS lecture\n' as unknown as ReturnType<typeof readFileSync>);
    expect(parseBatchFile('/batch.txt')).toEqual([
      { input: 'https://youtube.com/watch?v=abc', context: 'CS lecture' },
    ]);
  });

  it('omits context when the part after pipe is empty', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('https://example.com/video.mp4|\n' as unknown as ReturnType<typeof readFileSync>);
    expect(parseBatchFile('/batch.txt')).toEqual([
      { input: 'https://example.com/video.mp4' },
    ]);
  });

  it('skips comment lines mixed with real entries', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      '# header\nhttps://a.com/1\n# skip\nhttps://b.com/2\n' as unknown as ReturnType<typeof readFileSync>,
    );
    expect(parseBatchFile('/batch.txt')).toEqual([
      { input: 'https://a.com/1' },
      { input: 'https://b.com/2' },
    ]);
  });

  it('trims whitespace from input and context', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('  https://a.com/1  |  my context  \n' as unknown as ReturnType<typeof readFileSync>);
    expect(parseBatchFile('/batch.txt')).toEqual([
      { input: 'https://a.com/1', context: 'my context' },
    ]);
  });
});

describe('generateBatchIndex', () => {
  it('generates a markdown table with successful and failed items', () => {
    const results: BatchResult = {
      items: [
        {
          input: 'https://a.com/1',
          outputDir: '/out/my-video',
          title: 'My Video',
          duration: 330,
          success: true,
        },
        {
          input: 'https://b.com/2',
          outputDir: '/out/bad-video',
          title: 'Bad Video',
          duration: 0,
          success: false,
          error: 'Network error',
        },
        {
          input: 'https://c.com/3',
          outputDir: '/out/long-video',
          title: 'Long Video',
          duration: 3930,
          success: true,
        },
      ],
    };

    const md = generateBatchIndex(results, '/out');

    expect(md).toContain('# Batch Index');
    expect(md).toContain('3 items processed');

    // Successful item: duration formatted
    expect(md).toContain('5:30');
    // Long video: hours format
    expect(md).toContain('1:05:30');
    // Failed item: shows error
    expect(md).toContain('Network error');
    // Failed item: no link
    const lines = md.split('\n');
    const failedRow = lines.find((l) => l.includes('Bad Video'));
    expect(failedRow).toBeDefined();
    expect(failedRow).toContain('—');
  });

  it('generates singular "item" for a single-item batch', () => {
    const results: BatchResult = {
      items: [
        {
          input: 'https://a.com/1',
          outputDir: '/out/my-video',
          title: 'My Video',
          duration: 60,
          success: true,
        },
      ],
    };
    const md = generateBatchIndex(results, '/out');
    expect(md).toContain('1 item processed');
  });

  it('formats sub-minute duration as 0:30', () => {
    const results: BatchResult = {
      items: [
        {
          input: 'https://a.com/1',
          outputDir: '/out/my-video',
          title: 'My Video',
          duration: 30,
          success: true,
        },
      ],
    };
    const md = generateBatchIndex(results, '/out');
    expect(md).toContain('0:30');
  });
});
