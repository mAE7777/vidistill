import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const { readdirSync, statSync, readFileSync } = await import('node:fs');

describe('list command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  function makeMetadata(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      videoTitle: 'Test Video',
      duration: 630,
      type: 'lecture',
      generatedAt: '2025-01-15T10:00:00.000Z',
      filesGenerated: ['notes.md', 'transcript.md'],
      ...overrides,
    });
  }

  describe('empty directory', () => {
    it('prints "No vidistill output found" when no subdirectories', async () => {
      vi.mocked(readdirSync).mockReturnValue([]);

      const { run } = await import('./list.js');
      await run([]);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('No vidistill output found'),
      );
    });

    it('prints the scanned directory in the empty message', async () => {
      vi.mocked(readdirSync).mockReturnValue([]);

      const { run } = await import('./list.js');
      await run([]);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('./vidistill-output/'),
      );
    });

    it('prints custom dir in empty message when --dir flag used', async () => {
      vi.mocked(readdirSync).mockReturnValue([]);

      const { run } = await import('./list.js');
      await run(['--dir', './custom/']);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('./custom/'),
      );
    });
  });

  describe('--dir flag parsing', () => {
    it('uses default directory when no --dir provided', async () => {
      vi.mocked(readdirSync).mockReturnValue([]);

      const { run } = await import('./list.js');
      await run([]);

      expect(readdirSync).toHaveBeenCalledWith('./vidistill-output/');
    });

    it('uses custom directory when --dir <path> provided', async () => {
      vi.mocked(readdirSync).mockReturnValue([]);

      const { run } = await import('./list.js');
      await run(['--dir', './my-output/']);

      expect(readdirSync).toHaveBeenCalledWith('./my-output/');
    });
  });

  describe('missing metadata.json', () => {
    it('skips subdirectory without metadata.json without error', async () => {
      vi.mocked(readdirSync).mockReturnValue(['video-abc'] as any);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.mocked(readFileSync).mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });

      const { run } = await import('./list.js');
      await run([]);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('No vidistill output found'),
      );
    });

    it('skips subdirectory with malformed metadata.json', async () => {
      vi.mocked(readdirSync).mockReturnValue(['bad-dir'] as any);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.mocked(readFileSync).mockReturnValue('not valid json' as any);

      const { run } = await import('./list.js');
      await run([]);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('No vidistill output found'),
      );
    });

    it('skips non-directory entries', async () => {
      vi.mocked(readdirSync).mockReturnValue(['file.txt'] as any);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as any);

      const { run } = await import('./list.js');
      await run([]);

      expect(readFileSync).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('No vidistill output found'),
      );
    });
  });

  describe('table with 3 entries', () => {
    beforeEach(() => {
      vi.mocked(readdirSync).mockReturnValue(['vid-a', 'vid-b', 'vid-c'] as any);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        const p = String(path);
        if (p.includes('vid-a')) {
          return makeMetadata({
            videoTitle: 'Alpha Talk',
            duration: 600,
            type: 'lecture',
            generatedAt: '2025-01-10T10:00:00.000Z',
            filesGenerated: ['a.md', 'b.md'],
          });
        }
        if (p.includes('vid-b')) {
          return makeMetadata({
            videoTitle: 'Beta Session',
            duration: 1800,
            type: 'meeting',
            generatedAt: '2025-01-15T10:00:00.000Z',
            filesGenerated: ['c.md', 'd.md', 'e.md'],
          });
        }
        return makeMetadata({
          videoTitle: 'Gamma Demo',
          duration: 300,
          type: 'coding',
          generatedAt: '2025-01-12T10:00:00.000Z',
          filesGenerated: ['f.md'],
        });
      });
    });

    it('prints a header row with column names', async () => {
      const { run } = await import('./list.js');
      await run([]);

      const calls = vi.mocked(console.log).mock.calls.map((c) => c[0]);
      const header = calls.find((line) => String(line).includes('Title'));
      expect(header).toBeDefined();
      expect(header).toMatch(/Duration/);
      expect(header).toMatch(/Type/);
      expect(header).toMatch(/Date/);
      expect(header).toMatch(/Files/);
    });

    it('prints 3 data rows (plus header and separator)', async () => {
      const { run } = await import('./list.js');
      await run([]);

      const calls = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
      // header + separator + 3 data rows = 5 lines total
      expect(calls).toHaveLength(5);
    });

    it('includes video titles in output', async () => {
      const { run } = await import('./list.js');
      await run([]);

      const allOutput = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toContain('Alpha Talk');
      expect(allOutput).toContain('Beta Session');
      expect(allOutput).toContain('Gamma Demo');
    });

    it('formats duration as human-readable', async () => {
      const { run } = await import('./list.js');
      await run([]);

      const allOutput = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toContain('10m 0s');
      expect(allOutput).toContain('30m 0s');
      expect(allOutput).toContain('5m 0s');
    });

    it('includes file counts', async () => {
      const { run } = await import('./list.js');
      await run([]);

      const allOutput = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toContain('2');
      expect(allOutput).toContain('3');
      expect(allOutput).toContain('1');
    });
  });

  describe('date sorting', () => {
    it('sorts entries by generatedAt descending (most recent first)', async () => {
      vi.mocked(readdirSync).mockReturnValue(['old', 'new', 'mid'] as any);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        const p = String(path);
        if (p.includes('/old/')) {
          return makeMetadata({ videoTitle: 'Old Video', generatedAt: '2024-01-01T00:00:00.000Z' });
        }
        if (p.includes('/new/')) {
          return makeMetadata({ videoTitle: 'New Video', generatedAt: '2025-06-01T00:00:00.000Z' });
        }
        return makeMetadata({ videoTitle: 'Mid Video', generatedAt: '2025-01-01T00:00:00.000Z' });
      });

      const { run } = await import('./list.js');
      await run([]);

      const calls = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
      // rows: header, separator, new, mid, old
      expect(calls[2]).toContain('New Video');
      expect(calls[3]).toContain('Mid Video');
      expect(calls[4]).toContain('Old Video');
    });
  });
});
