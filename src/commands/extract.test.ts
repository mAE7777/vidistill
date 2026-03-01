import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Mocks (vi.hoisted so they are available in vi.mock factories)
// ---------------------------------------------------------------------------

const { mockLog } = vi.hoisted(() => ({
  mockLog: {
    info: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Make process.exit throw so tests can assert on it
vi.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('process.exit called');
}) as never);

vi.mock('@clack/prompts', () => ({ log: mockLog }));

// We don't test video mode in unit tests (requires network), so mock everything
vi.mock('../cli/config.js', () => ({
  resolveApiKey: vi.fn().mockResolvedValue('test-key'),
}));

vi.mock('../cli/progress.js', () => ({
  createProgressDisplay: vi.fn(() => ({
    update: vi.fn(),
    onWait: vi.fn(),
    complete: vi.fn(),
  })),
}));

vi.mock('../gemini/client.js', () => ({
  GeminiClient: vi.fn().mockImplementation(() => ({
    deleteFile: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../gemini/rate-limiter.js', () => ({
  RateLimiter: vi.fn(),
}));

vi.mock('../input/local-file.js', () => ({
  handleLocalFile: vi.fn().mockResolvedValue({
    fileUri: 'file://test',
    mimeType: 'video/mp4',
    duration: 300,
    uploadedFileName: null,
    isAudio: false,
  }),
}));

vi.mock('../input/duration.js', () => ({
  detectDuration: vi.fn().mockResolvedValue(300),
}));

vi.mock('../core/pipeline.js', () => ({
  runPipeline: vi.fn().mockResolvedValue({
    segments: [],
    passesRun: [],
    errors: [],
  }),
}));

vi.mock('../gemini/models.js', () => ({
  MODELS: { flash: 'gemini-2.0-flash', pro: 'gemini-2.5-pro' },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { run } from './extract.js';

let tmpDir: string;
let consoleLogCalls: string[];

function setupOutputDir(withMetadata = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'extract-test-'));
  if (withMetadata) {
    writeFileSync(join(dir, 'metadata.json'), JSON.stringify({ videoTitle: 'Test' }));
  }
  mkdirSync(join(dir, 'raw'), { recursive: true });
  return dir;
}

function writeRaw(dir: string, filename: string, data: unknown): void {
  writeFileSync(join(dir, 'raw', filename), JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extract command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogCalls = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleLogCalls.push(args.join(' '));
    });
    tmpDir = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir && tmpDir !== '') {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  // -------------------------------------------------------------------------
  // Validation: type
  // -------------------------------------------------------------------------

  describe('invalid extraction type', () => {
    it('shows error listing valid types', async () => {
      await expect(run(['badtype', '/some/path'])).rejects.toThrow();

      // process.exit(1) will throw in test env — check that error was logged
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('Unknown extraction type'));
    });

    it('lists all valid types in error', async () => {
      await expect(run(['nope', '/some/path'])).rejects.toThrow();

      const errorCalls = mockLog.error.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(errorCalls).toContain('code');
      expect(errorCalls).toContain('links');
      expect(errorCalls).toContain('people');
      expect(errorCalls).toContain('transcript');
      expect(errorCalls).toContain('commands');
    });

    it('shows error when no type is given', async () => {
      await expect(run([])).rejects.toThrow();
      expect(mockLog.error).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Validation: directory without metadata.json
  // -------------------------------------------------------------------------

  describe('directory without metadata.json', () => {
    it('shows error explaining not a vidistill output directory', async () => {
      tmpDir = setupOutputDir(false);

      await expect(run(['code', tmpDir])).rejects.toThrow();

      const errorCalls = mockLog.error.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(errorCalls).toContain('metadata.json');
    });
  });

  // -------------------------------------------------------------------------
  // Output mode: transcript
  // -------------------------------------------------------------------------

  describe('output mode — transcript', () => {
    it('prints transcript entries from pass1-seg files', async () => {
      tmpDir = setupOutputDir();
      writeRaw(tmpDir, 'pass1-seg0.json', {
        segment_index: 0,
        time_range: '0:00–5:00',
        transcript_entries: [
          { timestamp: '0:01', speaker: 'Alice', text: 'Hello world', tone: 'neutral' },
          { timestamp: '0:10', speaker: 'Bob', text: 'Hi there', tone: 'friendly' },
        ],
        speaker_summary: [],
      });
      writeRaw(tmpDir, 'pass1-seg1.json', {
        segment_index: 1,
        time_range: '5:00–10:00',
        transcript_entries: [
          { timestamp: '5:01', speaker: 'Alice', text: 'Continuing...', tone: 'neutral' },
        ],
        speaker_summary: [],
      });

      await run(['transcript', tmpDir]);

      const output = consoleLogCalls.join('\n');
      expect(output).toContain('Hello world');
      expect(output).toContain('Hi there');
      expect(output).toContain('Continuing...');
      expect(output).toContain('[Alice]');
      expect(output).toContain('[Bob]');
    });

    it('handles missing pass1 files gracefully', async () => {
      tmpDir = setupOutputDir();
      // no pass1 files written

      await run(['transcript', tmpDir]);

      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('No transcript data found'));
    });

    it('orders segments numerically (seg10 after seg9)', async () => {
      tmpDir = setupOutputDir();
      for (let i = 0; i <= 10; i++) {
        writeRaw(tmpDir, `pass1-seg${i}.json`, {
          segment_index: i,
          time_range: `${i}:00–${i + 1}:00`,
          transcript_entries: [
            { timestamp: `ts-${String(i).padStart(3, '0')}`, speaker: 'A', text: `Entry for segment ${i}`, tone: 'neutral' },
          ],
          speaker_summary: [],
        });
      }

      await run(['transcript', tmpDir]);

      // ts-009 (segment 9) should appear before ts-010 (segment 10) in output
      const output = consoleLogCalls.join('\n');
      const pos9 = output.indexOf('ts-009');
      const pos10 = output.indexOf('ts-010');
      expect(pos9).toBeGreaterThan(-1);
      expect(pos10).toBeGreaterThan(-1);
      expect(pos9).toBeLessThan(pos10);
    });
  });

  // -------------------------------------------------------------------------
  // Output mode: code
  // -------------------------------------------------------------------------

  describe('output mode — code', () => {
    it('prints code files from pass3a.json', async () => {
      tmpDir = setupOutputDir();
      writeRaw(tmpDir, 'pass3a.json', {
        files: [
          {
            filename: 'src/main.ts',
            language: 'typescript',
            final_content: 'const x = 1;',
            changes: [],
          },
          {
            filename: 'src/util.ts',
            language: 'typescript',
            final_content: 'export function help() {}',
            changes: [],
          },
        ],
        dependencies_mentioned: [],
        build_commands: [],
      });

      await run(['code', tmpDir]);

      const output = consoleLogCalls.join('\n');
      expect(output).toContain('src/main.ts');
      expect(output).toContain('const x = 1;');
      expect(output).toContain('src/util.ts');
      expect(output).toContain('export function help() {}');
    });

    it('handles missing pass3a.json gracefully', async () => {
      tmpDir = setupOutputDir();
      // no pass3a.json

      await run(['code', tmpDir]);

      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('No code data found'));
    });
  });

  // -------------------------------------------------------------------------
  // Output mode: links
  // -------------------------------------------------------------------------

  describe('output mode — links', () => {
    it('collects links from all pass3c-seg files', async () => {
      tmpDir = setupOutputDir();
      writeRaw(tmpDir, 'pass3c-seg0.json', {
        messages: [],
        links: [
          { url: 'https://example.com', context: 'Mentioned by Alice', timestamp: '1:00' },
        ],
      });
      writeRaw(tmpDir, 'pass3c-seg1.json', {
        messages: [],
        links: [
          { url: 'https://github.com/org/repo', context: 'Code repo', timestamp: '5:00' },
        ],
      });

      await run(['links', tmpDir]);

      const output = consoleLogCalls.join('\n');
      expect(output).toContain('https://example.com');
      expect(output).toContain('https://github.com/org/repo');
    });

    it('handles missing pass3c files gracefully', async () => {
      tmpDir = setupOutputDir();

      await run(['links', tmpDir]);

      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('No link data found'));
    });
  });

  // -------------------------------------------------------------------------
  // Output mode: people
  // -------------------------------------------------------------------------

  describe('output mode — people', () => {
    it('prints participants from pass3b-people.json', async () => {
      tmpDir = setupOutputDir();
      writeRaw(tmpDir, 'pass3b-people.json', {
        participants: [
          {
            name: 'Alice Smith',
            role: 'Engineer',
            organization: 'Acme Corp',
            speaking_segments: [],
            contact_info: [],
            contributions: ['Led the backend design', 'Reviewed PRs'],
          },
        ],
        relationships: [],
      });

      await run(['people', tmpDir]);

      const output = consoleLogCalls.join('\n');
      expect(output).toContain('Alice Smith');
      expect(output).toContain('Engineer');
      expect(output).toContain('Acme Corp');
      expect(output).toContain('Led the backend design');
    });

    it('handles missing pass3b-people.json gracefully', async () => {
      tmpDir = setupOutputDir();

      await run(['people', tmpDir]);

      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('No people data found'));
    });
  });

  // -------------------------------------------------------------------------
  // Output mode: commands
  // -------------------------------------------------------------------------

  describe('output mode — commands', () => {
    it('filters pass2 code_blocks where screen_type includes terminal', async () => {
      tmpDir = setupOutputDir();
      writeRaw(tmpDir, 'pass2-seg0.json', {
        segment_index: 0,
        time_range: '0:00–5:00',
        code_blocks: [
          {
            timestamp: '1:00',
            filename: '',
            language: 'bash',
            content: 'npm install',
            screen_type: 'terminal',
            change_type: 'execute',
            instructor_explanation: '',
          },
          {
            timestamp: '2:00',
            filename: 'index.ts',
            language: 'typescript',
            content: 'const x = 1;',
            screen_type: 'editor',
            change_type: 'add',
            instructor_explanation: '',
          },
        ],
        visual_notes: [],
        screen_timeline: [],
      });

      await run(['commands', tmpDir]);

      const output = consoleLogCalls.join('\n');
      expect(output).toContain('npm install');
      expect(output).not.toContain('const x = 1;');
    });

    it('handles missing pass2 files gracefully', async () => {
      tmpDir = setupOutputDir();

      await run(['commands', tmpDir]);

      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('No visual data found'));
    });

    it('reports no commands found when all blocks are non-terminal', async () => {
      tmpDir = setupOutputDir();
      writeRaw(tmpDir, 'pass2-seg0.json', {
        segment_index: 0,
        time_range: '0:00–5:00',
        code_blocks: [
          {
            timestamp: '1:00',
            filename: 'index.ts',
            language: 'typescript',
            content: 'const x = 1;',
            screen_type: 'editor',
            change_type: 'add',
            instructor_explanation: '',
          },
        ],
        visual_notes: [],
        screen_timeline: [],
      });

      await run(['commands', tmpDir]);

      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('No terminal commands found'));
    });
  });

  // -------------------------------------------------------------------------
  // --lang flag parsing
  // -------------------------------------------------------------------------

  describe('--lang flag', () => {
    it('is parsed and does not interfere with type/source args', async () => {
      tmpDir = setupOutputDir();

      // Should not throw — lang is parsed separately
      await run(['transcript', tmpDir, '--lang', 'ja']);

      // No data → graceful info message (no pass1 files)
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('No transcript data found'));
    });
  });
});
