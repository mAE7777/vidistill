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
  MODELS: { flash: 'gemini-3.1-flash-lite-preview' },
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

  describe('getNotes', () => {
    it('should return formatted notes from synthesis.json', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({
        overview: 'A great talk about TypeScript.',
        key_decisions: [{ decision: 'Use strict mode', timestamp: '1:00', context: 'for safety' }],
        key_concepts: [{ concept: 'Type narrowing', explanation: 'Refine types via checks', timestamp: '2:30' }],
        topics: [{
          title: 'Intro',
          timestamps: ['0:00'],
          summary: 'Overview of the session',
          key_points: ['Point one', 'Point two'],
        }],
        suggestions: ['Read the docs'],
        action_items: [],
        questions_raised: [],
        files_to_generate: [],
        prerequisites: [],
      }));

      const { getNotes } = await import('./mcp.js');
      const result = await getNotes('/test/output');
      expect(result).toContain('## Overview');
      expect(result).toContain('A great talk about TypeScript.');
      expect(result).toContain('## Key Decisions');
      expect(result).toContain('[1:00] Use strict mode (for safety)');
      expect(result).toContain('## Key Concepts');
      expect(result).toContain('[2:30] Type narrowing: Refine types via checks');
      expect(result).toContain('## Topics');
      expect(result).toContain('### Intro');
      expect(result).toContain('Overview of the session');
      expect(result).toContain('- Point one');
      expect(result).toContain('## Suggestions');
      expect(result).toContain('- Read the docs');
    });

    it('should throw when synthesis.json is missing', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

      const { getNotes } = await import('./mcp.js');
      await expect(getNotes('/test/output')).rejects.toThrow('No notes data found');
    });

    it('should throw for non-existent output directory', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const { getNotes } = await import('./mcp.js');
      await expect(getNotes('/nonexistent')).rejects.toThrow('Not a vidistill output directory');
    });

    it('should not include action_items in output', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({
        overview: 'Summary',
        key_decisions: [],
        key_concepts: [],
        topics: [],
        suggestions: [],
        action_items: [{ item: 'Do something', timestamp: '0:01', mentioned_by: 'Alice' }],
        questions_raised: [],
        files_to_generate: [],
        prerequisites: [],
      }));

      const { getNotes } = await import('./mcp.js');
      const result = await getNotes('/test/output');
      expect(result).not.toContain('Action Items');
      expect(result).not.toContain('Do something');
    });
  });

  describe('getPeople', () => {
    it('should return formatted participant details', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({
        participants: [
          {
            name: 'Alice Smith',
            role: 'Lead Engineer',
            organization: 'Acme Corp',
            speaking_segments: ['0:00-2:00'],
            contact_info: [],
            contributions: ['Designed the system', 'Wrote the spec'],
          },
          {
            name: 'Bob Jones',
            role: '',
            organization: '',
            speaking_segments: [],
            contact_info: [],
            contributions: [],
          },
        ],
        relationships: [],
      }));

      const { getPeople } = await import('./mcp.js');
      const result = await getPeople('/test/output');
      expect(result).toContain('### Alice Smith');
      expect(result).toContain('- Role: Lead Engineer');
      expect(result).toContain('- Organization: Acme Corp');
      expect(result).toContain('- Contributions:');
      expect(result).toContain('  - Designed the system');
      expect(result).toContain('  - Wrote the spec');
      expect(result).toContain('### Bob Jones');
      expect(result).not.toContain('- Role: \n');
    });

    it('should throw when people file is missing', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

      const { getPeople } = await import('./mcp.js');
      await expect(getPeople('/test/output')).rejects.toThrow('No people data found');
    });

    it('should throw when participants array is empty', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({
        participants: [],
        relationships: [],
      }));

      const { getPeople } = await import('./mcp.js');
      await expect(getPeople('/test/output')).rejects.toThrow('No people data found');
    });

    it('should throw for non-existent output directory', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const { getPeople } = await import('./mcp.js');
      await expect(getPeople('/nonexistent')).rejects.toThrow('Not a vidistill output directory');
    });
  });

  describe('getActionItems', () => {
    it('should return formatted action items from pass3d files', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['pass3d-seg0.json', 'synthesis.json'] as any);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({
        emotional_shifts: [],
        questions_implicit: [],
        decisions_implicit: [],
        tasks_assigned: [
          { timestamp: '2:00', assignee: 'Alice', task: 'Write tests', deadline: 'Friday' },
          { timestamp: '1:00', assignee: 'Bob', task: 'Fix bug', deadline: 'Tomorrow' },
        ],
        emphasis_patterns: [],
      }));

      const { getActionItems } = await import('./mcp.js');
      const result = await getActionItems('/test/output');
      const lines = result.split('\n');
      expect(lines[0]).toBe('[1:00] Bob: Fix bug (Tomorrow)');
      expect(lines[1]).toBe('[2:00] Alice: Write tests (Friday)');
    });

    it('should throw when no pass3d files found', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['pass1-seg0.json', 'synthesis.json'] as any);

      const { getActionItems } = await import('./mcp.js');
      await expect(getActionItems('/test/output')).rejects.toThrow('No action items found');
    });

    it('should throw when pass3d files have no tasks', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['pass3d-seg0.json'] as any);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({
        emotional_shifts: [],
        questions_implicit: [],
        decisions_implicit: [],
        tasks_assigned: [],
        emphasis_patterns: [],
      }));

      const { getActionItems } = await import('./mcp.js');
      await expect(getActionItems('/test/output')).rejects.toThrow('No action items found');
    });

    it('should combine tasks from multiple segments sorted by timestamp', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['pass3d-seg0.json', 'pass3d-seg1.json'] as any);
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).includes('seg0')) {
          return JSON.stringify({
            emotional_shifts: [],
            questions_implicit: [],
            decisions_implicit: [],
            tasks_assigned: [
              { timestamp: '5:00', assignee: 'Carol', task: 'Deploy service', deadline: 'Next week' },
            ],
            emphasis_patterns: [],
          });
        }
        return JSON.stringify({
          emotional_shifts: [],
          questions_implicit: [],
          decisions_implicit: [],
          tasks_assigned: [
            { timestamp: '0:30', assignee: 'Dave', task: 'Review PR', deadline: 'Today' },
          ],
          emphasis_patterns: [],
        });
      });

      const { getActionItems } = await import('./mcp.js');
      const result = await getActionItems('/test/output');
      const lines = result.split('\n');
      expect(lines[0]).toBe('[0:30] Dave: Review PR (Today)');
      expect(lines[1]).toBe('[5:00] Carol: Deploy service (Next week)');
    });

    it('should throw for non-existent output directory', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const { getActionItems } = await import('./mcp.js');
      await expect(getActionItems('/nonexistent')).rejects.toThrow('Not a vidistill output directory');
    });
  });

  describe('getChat', () => {
    it('should return formatted chat messages sorted by timestamp', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['pass3c-seg0.json', 'synthesis.json'] as any);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({
        messages: [
          { timestamp: '2:00', sender: 'Alice', text: 'See you later' },
          { timestamp: '0:30', sender: 'Bob', text: 'Hello everyone' },
        ],
        links: [],
      }));

      const { getChat } = await import('./mcp.js');
      const result = await getChat('/test/output');
      const lines = result.split('\n');
      expect(lines[0]).toBe('[0:30] Bob: Hello everyone');
      expect(lines[1]).toBe('[2:00] Alice: See you later');
    });

    it('should throw when no pass3c files found', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['pass1-seg0.json', 'synthesis.json'] as any);

      const { getChat } = await import('./mcp.js');
      await expect(getChat('/test/output')).rejects.toThrow('No chat data found');
    });

    it('should throw when pass3c files have no messages', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['pass3c-seg0.json'] as any);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({
        messages: [],
        links: [],
      }));

      const { getChat } = await import('./mcp.js');
      await expect(getChat('/test/output')).rejects.toThrow('No chat data found');
    });

    it('should merge messages from multiple segments sorted by timestamp', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['pass3c-seg0.json', 'pass3c-seg1.json'] as any);
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).includes('seg0')) {
          return JSON.stringify({
            messages: [
              { timestamp: '5:00', sender: 'Carol', text: 'Wrapping up' },
            ],
            links: [],
          });
        }
        return JSON.stringify({
          messages: [
            { timestamp: '0:15', sender: 'Dave', text: 'Good morning' },
          ],
          links: [],
        });
      });

      const { getChat } = await import('./mcp.js');
      const result = await getChat('/test/output');
      const lines = result.split('\n');
      expect(lines[0]).toBe('[0:15] Dave: Good morning');
      expect(lines[1]).toBe('[5:00] Carol: Wrapping up');
    });

    it('should throw for non-existent output directory', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const { getChat } = await import('./mcp.js');
      await expect(getChat('/nonexistent')).rejects.toThrow('Not a vidistill output directory');
    });
  });

  describe('getLinks', () => {
    it('should return links.md content directly when file exists', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('links.md')) return '# Links\n- https://example.com';
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });

      const { getLinks } = await import('./mcp.js');
      const result = await getLinks('/test/output');
      expect(result).toBe('# Links\n- https://example.com');
    });

    it('should fall back to pass3c data when links.md is missing', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['pass3c-seg0.json'] as any);
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('links.md')) {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }
        return JSON.stringify({
          messages: [],
          links: [
            { url: 'https://example.com', context: 'Mentioned during intro', timestamp: '1:00' },
          ],
        });
      });

      const { getLinks } = await import('./mcp.js');
      const result = await getLinks('/test/output');
      expect(result).toBe('[1:00] https://example.com — Mentioned during intro');
    });

    it('should deduplicate links by URL across segments', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['pass3c-seg0.json', 'pass3c-seg1.json'] as any);
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('links.md')) {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }
        if (String(path).includes('seg0')) {
          return JSON.stringify({
            messages: [],
            links: [
              { url: 'https://example.com', context: 'First mention', timestamp: '0:30' },
            ],
          });
        }
        return JSON.stringify({
          messages: [],
          links: [
            { url: 'https://example.com', context: 'Second mention', timestamp: '5:00' },
            { url: 'https://other.com', context: 'Another link', timestamp: '6:00' },
          ],
        });
      });

      const { getLinks } = await import('./mcp.js');
      const result = await getLinks('/test/output');
      const lines = result.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe('[0:30] https://example.com — First mention');
      expect(lines[1]).toBe('[6:00] https://other.com — Another link');
    });

    it('should throw when no links data is found', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['pass3c-seg0.json'] as any);
      vi.mocked(readFile).mockImplementation(async (path: any) => {
        if (String(path).endsWith('links.md')) {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }
        return JSON.stringify({ messages: [], links: [] });
      });

      const { getLinks } = await import('./mcp.js');
      await expect(getLinks('/test/output')).rejects.toThrow('No links found');
    });

    it('should throw for non-existent output directory', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const { getLinks } = await import('./mcp.js');
      await expect(getLinks('/nonexistent')).rejects.toThrow('Not a vidistill output directory');
    });
  });

  describe('tool registration', () => {
    it('should register 8 tools with McpServer', async () => {
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
        expect(mockRegisterTool).toHaveBeenCalledTimes(8);
        const toolNames = mockRegisterTool.mock.calls.map((call: any[]) => call[0]);
        expect(toolNames).toContain('analyze_video');
        expect(toolNames).toContain('get_transcript');
        expect(toolNames).toContain('get_code');
        expect(toolNames).toContain('get_notes');
        expect(toolNames).toContain('get_people');
        expect(toolNames).toContain('get_action_items');
        expect(toolNames).toContain('get_chat');
        expect(toolNames).toContain('get_links');
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
