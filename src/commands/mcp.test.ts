import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('../cli/config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({ apiKey: 'test-key' }),
}));

vi.mock('../gemini/client.js', () => ({
  GeminiClient: vi.fn(),
}));

vi.mock('../gemini/rate-limiter.js', () => ({
  RateLimiter: vi.fn(),
}));

vi.mock('../input/resolver.js', () => ({
  resolveInput: vi.fn(),
}));

vi.mock('../input/youtube.js', () => ({
  handleYouTube: vi.fn(),
  extractVideoId: vi.fn(),
}));

vi.mock('../input/local-file.js', () => ({
  handleLocalFile: vi.fn(),
}));

vi.mock('../input/duration.js', () => ({
  detectDuration: vi.fn(),
}));

vi.mock('../core/pipeline.js', () => ({
  runPipeline: vi.fn(),
}));

vi.mock('../output/generator.js', () => ({
  generateOutput: vi.fn(),
  slugify: vi.fn((s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
}));

vi.mock('../gemini/models.js', () => ({
  MODELS: { flash: 'gemini-2.0-flash' },
}));

describe('MCP server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveApiKeyNonInteractive', () => {
    it('should return env var when set', async () => {
      process.env['GEMINI_API_KEY'] = 'env-key-123';
      const { resolveApiKeyNonInteractive } = await import('./mcp.js');
      const key = await resolveApiKeyNonInteractive();
      expect(key).toBe('env-key-123');
      delete process.env['GEMINI_API_KEY'];
    });

    it('should trim env var whitespace', async () => {
      process.env['GEMINI_API_KEY'] = '  spaced-key  ';
      const { resolveApiKeyNonInteractive } = await import('./mcp.js');
      const key = await resolveApiKeyNonInteractive();
      expect(key).toBe('spaced-key');
      delete process.env['GEMINI_API_KEY'];
    });

    it('should fall back to config when env var is empty', async () => {
      process.env['GEMINI_API_KEY'] = '';
      const { resolveApiKeyNonInteractive } = await import('./mcp.js');
      const key = await resolveApiKeyNonInteractive();
      expect(key).toBe('test-key');
      delete process.env['GEMINI_API_KEY'];
    });

    it('should fall back to config when env var is whitespace-only', async () => {
      process.env['GEMINI_API_KEY'] = '   ';
      const { resolveApiKeyNonInteractive } = await import('./mcp.js');
      const key = await resolveApiKeyNonInteractive();
      expect(key).toBe('test-key');
      delete process.env['GEMINI_API_KEY'];
    });

    it('should throw when no key available', async () => {
      delete process.env['GEMINI_API_KEY'];
      const { loadConfig } = await import('../cli/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({});
      const { resolveApiKeyNonInteractive } = await import('./mcp.js');
      await expect(resolveApiKeyNonInteractive()).rejects.toThrow('GEMINI_API_KEY not set');
    });
  });

  describe('getTranscript', () => {
    it('should read and format transcript entries from pass1 files', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['pass1-seg0.json', 'synthesis.json'] as any);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({
        transcript_entries: [
          { timestamp: '0:00', speaker: 'Alice', text: 'Hello', tone: 'neutral' },
          { timestamp: '0:15', speaker: null, text: 'Background noise', tone: 'neutral' },
        ],
      }));

      const { getTranscript } = await import('./mcp.js');
      const result = await getTranscript('/test/output');
      expect(result).toBe('[0:00] Alice: Hello\n[0:15] Background noise');
    });

    it('should filter by startTime', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['pass1-seg0.json'] as any);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({
        transcript_entries: [
          { timestamp: '0:00', speaker: 'A', text: 'Early', tone: 'neutral' },
          { timestamp: '5:00', speaker: 'A', text: 'Later', tone: 'neutral' },
        ],
      }));

      const { getTranscript } = await import('./mcp.js');
      const result = await getTranscript('/test/output', 200);
      expect(result).toBe('[5:00] A: Later');
    });

    it('should filter by endTime', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['pass1-seg0.json'] as any);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({
        transcript_entries: [
          { timestamp: '0:00', speaker: 'A', text: 'Early', tone: 'neutral' },
          { timestamp: '5:00', speaker: 'A', text: 'Later', tone: 'neutral' },
        ],
      }));

      const { getTranscript } = await import('./mcp.js');
      const result = await getTranscript('/test/output', undefined, 60);
      expect(result).toBe('[0:00] A: Early');
    });

    it('should return empty string for empty transcript_entries', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['pass1-seg0.json'] as any);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ transcript_entries: [] }));

      const { getTranscript } = await import('./mcp.js');
      const result = await getTranscript('/test/output');
      expect(result).toBe('');
    });

    it('should skip files with null transcript_entries', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['pass1-seg0.json'] as any);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ transcript_entries: null }));

      const { getTranscript } = await import('./mcp.js');
      const result = await getTranscript('/test/output');
      expect(result).toBe('');
    });

    it('should throw for non-existent output directory', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const { getTranscript } = await import('./mcp.js');
      await expect(getTranscript('/nonexistent')).rejects.toThrow('Not a vidistill output directory');
    });

    it('should throw when no pass1 files found', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['synthesis.json'] as any);

      const { getTranscript } = await import('./mcp.js');
      await expect(getTranscript('/test/output')).rejects.toThrow('No extracted data found');
    });
  });

  describe('getCode', () => {
    it('should return empty array when code directory does not exist', async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => !String(p).includes('code'));

      const { getCode } = await import('./mcp.js');
      const result = await getCode('/test/output');
      expect(result).toEqual([]);
    });

    it('should read code files with content', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['main.py', 'utils.py'] as any);
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).includes('main.py')) return 'print("hello")';
        return 'def helper(): pass';
      });

      const { getCode } = await import('./mcp.js');
      const result = await getCode('/test/output');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ filename: 'main.py', content: 'print("hello")' });
      expect(result[1]).toEqual({ filename: 'utils.py', content: 'def helper(): pass' });
    });

    it('should throw for non-existent output directory', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const { getCode } = await import('./mcp.js');
      await expect(getCode('/nonexistent')).rejects.toThrow('Not a vidistill output directory');
    });
  });

  describe('tool registration', () => {
    it('should register 3 tools with McpServer', async () => {
      const mockRegisterTool = vi.fn();
      const mockConnect = vi.fn();
      const mockClose = vi.fn();

      vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
        McpServer: vi.fn().mockImplementation(() => ({
          registerTool: mockRegisterTool,
          connect: mockConnect,
          close: mockClose,
        })),
      }));

      vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: vi.fn(),
      }));

      vi.doMock('zod', () => {
        const obj = vi.fn((shape: any) => shape);
        const str = vi.fn(() => ({ optional: vi.fn(() => ({ describe: vi.fn(() => ({})) })), describe: vi.fn(() => ({})) }));
        const num = vi.fn(() => ({ optional: vi.fn(() => ({ describe: vi.fn(() => ({})) })), describe: vi.fn(() => ({})) }));
        return { object: obj, string: str, number: num };
      });

      const { run } = await import('./mcp.js');

      const originalOn = process.on;
      process.on = vi.fn().mockImplementation((event, handler) => {
        return process;
      }) as any;

      try {
        await run([]);
        expect(mockRegisterTool).toHaveBeenCalledTimes(3);
        const toolNames = mockRegisterTool.mock.calls.map((call: any[]) => call[0]);
        expect(toolNames).toContain('analyze_video');
        expect(toolNames).toContain('get_transcript');
        expect(toolNames).toContain('get_code');
        expect(mockConnect).toHaveBeenCalledTimes(1);
      } finally {
        process.on = originalOn;
      }
    });
  });

  describe('parseTimestamp for time filtering', () => {
    it('should parse MM:SS timestamps', async () => {
      const { parseTimestamp } = await import('../lib/utils.js');
      expect(parseTimestamp('5:30')).toBe(330);
      expect(parseTimestamp('0:00')).toBe(0);
      expect(parseTimestamp('10:15')).toBe(615);
    });

    it('should parse HH:MM:SS timestamps', async () => {
      const { parseTimestamp } = await import('../lib/utils.js');
      expect(parseTimestamp('1:05:30')).toBe(3930);
    });
  });
});
