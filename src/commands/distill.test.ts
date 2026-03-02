import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineResult } from '../types/index.js';

const { mockLog, mockProgress, mockRunPipeline, mockGenerateOutput, mockShutdownHandler } =
  vi.hoisted(() => ({
    mockLog: {
      info: vi.fn(),
      warn: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
    },
    mockProgress: {
      update: vi.fn(),
      onWait: vi.fn(),
      complete: vi.fn(),
    },
    mockRunPipeline: vi.fn(),
    mockGenerateOutput: vi.fn(),
    mockShutdownHandler: {
      register: vi.fn(),
      deregister: vi.fn(),
      isShuttingDown: vi.fn().mockReturnValue(false),
      setProgress: vi.fn(),
    },
  }));

vi.mock('@clack/prompts', () => ({
  log: mockLog,
  cancel: vi.fn(),
}));

vi.mock('picocolors', () => ({
  default: {
    dim: (s: string) => s,
    cyan: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
  },
}));

vi.mock('../cli/ui.js', () => ({
  showConfigBox: vi.fn(),
}));

vi.mock('../cli/prompts.js', () => ({
  promptVideoSource: vi.fn(),
  promptContext: vi.fn(),
  promptConfirmation: vi.fn(),
}));

vi.mock('../cli/config.js', () => ({
  resolveApiKey: vi.fn().mockResolvedValue('test-key'),
}));

vi.mock('../cli/progress.js', () => ({
  createProgressDisplay: vi.fn(() => mockProgress),
}));

vi.mock('../gemini/client.js', () => ({
  GeminiClient: vi.fn(),
}));

vi.mock('../gemini/rate-limiter.js', () => ({
  RateLimiter: vi.fn(),
}));

vi.mock('../input/resolver.js', () => ({
  resolveInput: vi.fn().mockReturnValue({ type: 'local', value: '/tmp/video.mp4' }),
}));

vi.mock('../input/youtube.js', () => ({
  handleYouTube: vi.fn(),
  extractVideoId: vi.fn(),
}));

vi.mock('../input/local-file.js', () => ({
  handleLocalFile: vi.fn().mockResolvedValue({
    fileUri: 'file://test',
    mimeType: 'video/mp4',
    duration: 300,
    uploadedFileName: null,
  }),
}));

vi.mock('../input/duration.js', () => ({
  detectDuration: vi.fn().mockResolvedValue(300),
}));

vi.mock('../core/pipeline.js', () => ({
  runPipeline: (...args: unknown[]) => mockRunPipeline(args[0]),
}));

vi.mock('../output/generator.js', () => ({
  generateOutput: (...args: unknown[]) => mockGenerateOutput(args[0]),
  slugify: vi.fn().mockReturnValue('video'),
}));

vi.mock('../core/shutdown.js', () => ({
  createShutdownHandler: vi.fn(() => mockShutdownHandler),
}));

vi.mock('../gemini/models.js', () => ({
  MODELS: { flash: 'gemini-2.0-flash', pro: 'gemini-2.5-pro' },
}));

import { runDistill } from './distill.js';

function basePipelineResult(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
    segments: [],
    passesRun: ['pass1', 'pass2'],
    errors: [],
    videoProfile: undefined,
    strategy: undefined,
    synthesisResult: undefined,
    peopleExtraction: null,
    codeReconstruction: null,
    uncertainCodeFiles: undefined,
    interrupted: undefined,
    ...overrides,
  };
}

describe('runDistill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateOutput.mockResolvedValue({ outputDir: '/tmp', filesGenerated: [], errors: [] });
  });

  describe('interrupted pipeline', () => {
    it('skips completion output when pipeline was interrupted', async () => {
      mockRunPipeline.mockResolvedValue(basePipelineResult({
        interrupted: ['segments 2-4 (all passes)', 'pass3a'],
      }));

      await runDistill({ input: '/tmp/video.mp4', context: 'test', output: './out' });

      expect(mockLog.success).not.toHaveBeenCalled();
      expect(mockGenerateOutput).not.toHaveBeenCalled();
    });

    it('still deregisters shutdown handler when interrupted', async () => {
      mockRunPipeline.mockResolvedValue(basePipelineResult({
        interrupted: ['pass3a'],
      }));

      await runDistill({ input: '/tmp/video.mp4', context: 'test', output: './out' });

      expect(mockShutdownHandler.deregister).toHaveBeenCalled();
    });
  });

  describe('completion output', () => {
    it('shows elapsed seconds only when under 1 minute', async () => {
      mockRunPipeline.mockImplementation(async () => {
        return basePipelineResult();
      });

      await runDistill({ input: '/tmp/video.mp4', context: 'test', output: './out' });

      const successCall = mockLog.success.mock.calls[0][0] as string;
      expect(successCall).toMatch(/Done in \d+s/);
      expect(successCall).not.toContain('m ');
    });

    it('shows output path', async () => {
      mockRunPipeline.mockResolvedValue(basePipelineResult());

      await runDistill({ input: '/tmp/video.mp4', context: 'test', output: './out' });

      const infoCalls = (mockLog.info.mock.calls as string[][]).map(c => c[0]);
      expect(infoCalls.some((c: string) => c.includes('Output:'))).toBe(true);
    });

    it('shows guide.md hint', async () => {
      mockRunPipeline.mockResolvedValue(basePipelineResult());

      await runDistill({ input: '/tmp/video.mp4', context: 'test', output: './out' });

      const infoCalls = (mockLog.info.mock.calls as string[][]).map(c => c[0]);
      expect(infoCalls.some((c: string) => c.includes('guide.md'))).toBe(true);
    });
  });

  describe('contextual tips', () => {
    it('shows extract tip when code was reconstructed', async () => {
      mockRunPipeline.mockResolvedValue(basePipelineResult({
        codeReconstruction: { files: [], dependencies_mentioned: [], build_commands: [] },
      }));

      await runDistill({ input: '/tmp/video.mp4', context: 'test', output: './out' });

      const infoCalls = (mockLog.info.mock.calls as string[][]).map(c => c[0]);
      expect(infoCalls.some((c: string) => c.includes('extract code'))).toBe(true);
    });

    it('shows rename-speakers tip when multiple participants', async () => {
      mockRunPipeline.mockResolvedValue(basePipelineResult({
        peopleExtraction: {
          participants: [
            { name: 'Alice', role: 'speaker' },
            { name: 'Bob', role: 'speaker' },
          ],
        } as PipelineResult['peopleExtraction'],
      }));

      await runDistill({ input: '/tmp/video.mp4', context: 'test', output: './out' });

      const infoCalls = (mockLog.info.mock.calls as string[][]).map(c => c[0]);
      expect(infoCalls.some((c: string) => c.includes('rename-speakers'))).toBe(true);
    });

    it('prefers code tip over speakers tip', async () => {
      mockRunPipeline.mockResolvedValue(basePipelineResult({
        codeReconstruction: { files: [], dependencies_mentioned: [], build_commands: [] },
        peopleExtraction: {
          participants: [
            { name: 'Alice', role: 'speaker' },
            { name: 'Bob', role: 'speaker' },
          ],
        } as PipelineResult['peopleExtraction'],
      }));

      await runDistill({ input: '/tmp/video.mp4', context: 'test', output: './out' });

      const infoCalls = (mockLog.info.mock.calls as string[][]).map(c => c[0]);
      expect(infoCalls.some((c: string) => c.includes('extract code'))).toBe(true);
      expect(infoCalls.some((c: string) => c.includes('rename-speakers'))).toBe(false);
    });
  });

  describe('output errors', () => {
    it('displays output errors when present', async () => {
      mockRunPipeline.mockResolvedValue(basePipelineResult());
      mockGenerateOutput.mockResolvedValue({
        outputDir: '/tmp',
        filesGenerated: [],
        errors: ['Failed to write transcript.md', 'Failed to write guide.md'],
      });

      await runDistill({ input: '/tmp/video.mp4', context: 'test', output: './out' });

      expect(mockLog.warn).toHaveBeenCalled();
      const warnCalls = (mockLog.warn.mock.calls as string[][]).map(c => c[0]);
      expect(warnCalls.some((c: string) => c.includes('2'))).toBe(true);
    });

    it('does not warn when no output errors', async () => {
      mockRunPipeline.mockResolvedValue(basePipelineResult());

      await runDistill({ input: '/tmp/video.mp4', context: 'test', output: './out' });

      expect(mockLog.warn).not.toHaveBeenCalled();
    });
  });

  describe('confirmation skip', () => {
    it('skips confirmation when all CLI flags provided', async () => {
      mockRunPipeline.mockResolvedValue(basePipelineResult());

      const { promptConfirmation } = await import('../cli/prompts.js');

      await runDistill({ input: '/tmp/video.mp4', context: 'test', output: './out' });

      expect(promptConfirmation).not.toHaveBeenCalled();
    });
  });
});
