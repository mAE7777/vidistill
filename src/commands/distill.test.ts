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
  note: vi.fn(),
  confirm: vi.fn().mockResolvedValue(true),
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
  promptOutputName: vi.fn().mockResolvedValue(undefined),
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
  MODELS: { flash: 'gemini-3.1-flash-lite-preview', pro: 'gemini-3-flash-preview' },
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
    apiCallCount: 0,
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

    it('does not show rename-speakers tip with single participant', async () => {
      mockRunPipeline.mockResolvedValue(basePipelineResult({
        peopleExtraction: {
          participants: [
            { name: 'Alice', role: 'speaker' },
          ],
        } as PipelineResult['peopleExtraction'],
      }));

      await runDistill({ input: '/tmp/video.mp4', context: 'test', output: './out' });

      const infoCalls = (mockLog.info.mock.calls as string[][]).map(c => c[0]);
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

  describe('cost estimate callback', () => {
    it('passes onPass0Complete to runPipeline and shows cost estimate', async () => {
      const { note, confirm } = await import('@clack/prompts');
      (confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      mockRunPipeline.mockImplementation(async (config: Record<string, unknown>) => {
        if (typeof config.onPass0Complete === 'function') {
          const mockProfile = { type: 'coding', speakers: { count: 1, identified: [] }, visualContent: {}, audioContent: {}, complexity: 'moderate', recommendations: {} };
          const mockStrategy = { passes: ['transcript', 'visual', 'code', 'synthesis'], resolution: 'medium', segmentMinutes: 10 };
          await config.onPass0Complete(mockProfile, mockStrategy, 3);
        }
        return basePipelineResult({ apiCallCount: 27 });
      });

      await runDistill({ input: '/tmp/video.mp4', context: 'test', output: './out' });

      expect(note).toHaveBeenCalledWith(
        expect.stringContaining('API calls'),
        'Cost estimate',
      );
      expect(confirm).toHaveBeenCalledWith({ message: 'Proceed?' });
    });

    it('aborts pipeline when user declines cost estimate', async () => {
      const { confirm } = await import('@clack/prompts');
      (confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      mockRunPipeline.mockImplementation(async (config: Record<string, unknown>) => {
        if (typeof config.onPass0Complete === 'function') {
          const mockProfile = { type: 'coding', speakers: { count: 1, identified: [] }, visualContent: {}, audioContent: {}, complexity: 'moderate', recommendations: {} };
          const mockStrategy = { passes: ['transcript', 'visual'], resolution: 'medium', segmentMinutes: 10 };
          const proceed = await config.onPass0Complete(mockProfile, mockStrategy, 1);
          if (!proceed) {
            return basePipelineResult({ segments: [], passesRun: [] });
          }
        }
        return basePipelineResult();
      });

      await runDistill({ input: '/tmp/video.mp4', context: 'test', output: './out' });

      expect(confirm).toHaveBeenCalled();
    });

    it('aborts gracefully when user presses Ctrl+C at cost estimate', async () => {
      const { confirm } = await import('@clack/prompts');
      (confirm as ReturnType<typeof vi.fn>).mockResolvedValue(Symbol('clack:cancel'));

      mockRunPipeline.mockImplementation(async (config: Record<string, unknown>) => {
        if (typeof config.onPass0Complete === 'function') {
          const mockProfile = { type: 'coding', speakers: { count: 1, identified: [] }, visualContent: {}, audioContent: {}, complexity: 'moderate', recommendations: {} };
          const mockStrategy = { passes: ['transcript', 'visual'], resolution: 'medium', segmentMinutes: 10 };
          const proceed = await config.onPass0Complete(mockProfile, mockStrategy, 1);
          if (!proceed) {
            return basePipelineResult({ segments: [], passesRun: [] });
          }
        }
        return basePipelineResult();
      });

      await runDistill({ input: '/tmp/video.mp4', context: 'test', output: './out' });

      expect(confirm).toHaveBeenCalled();
    });
  });

  describe('post-pipeline summary', () => {
    it('displays summary with API calls, duration, and token usage', async () => {
      const { note } = await import('@clack/prompts');

      mockRunPipeline.mockResolvedValue(basePipelineResult({
        apiCallCount: 27,
        consensusAgreementRate: 0.85,
        tokenUsage: { promptTokens: 50000, candidatesTokens: 10000, totalTokens: 60000 },
      }));

      await runDistill({ input: '/tmp/video.mp4', context: 'test', output: './out' });

      const noteCalls = (note as ReturnType<typeof vi.fn>).mock.calls;
      const summaryCall = noteCalls.find((c: unknown[]) => c[1] === 'Summary');
      expect(summaryCall).toBeDefined();
      const summaryText = summaryCall![0] as string;
      expect(summaryText).toContain('API calls: 27');
      expect(summaryText).toContain('Consensus: 85%');
      expect(summaryText).toContain('Tokens:');
    });
  });
});
