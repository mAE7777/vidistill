/**
 * Tests for clip pipeline routing in the distill command.
 * Verifies that long videos are routed to the clip pipeline,
 * short videos stay on the standard pipeline, and edge cases are handled.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineResult } from '../types/index.js';

const {
  mockLog, mockProgress, mockRunPipeline, mockRunClipPipeline, mockGenerateOutput,
  mockShutdownHandler, mockSplitVideo, mockCleanupClips, mockUploadClips,
} = vi.hoisted(() => ({
  mockLog: { info: vi.fn(), warn: vi.fn(), success: vi.fn(), error: vi.fn() },
  mockProgress: { update: vi.fn(), onWait: vi.fn(), complete: vi.fn() },
  mockRunPipeline: vi.fn(),
  mockRunClipPipeline: vi.fn(),
  mockGenerateOutput: vi.fn(),
  mockShutdownHandler: {
    register: vi.fn(),
    deregister: vi.fn(),
    isShuttingDown: vi.fn().mockReturnValue(false),
    setProgress: vi.fn(),
  },
  mockSplitVideo: vi.fn(),
  mockCleanupClips: vi.fn(),
  mockUploadClips: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
  log: mockLog,
  cancel: vi.fn(),
  note: vi.fn(),
  confirm: vi.fn().mockResolvedValue(true),
}));

vi.mock('picocolors', () => ({
  default: { dim: (s: string) => s, cyan: (s: string) => s, red: (s: string) => s, yellow: (s: string) => s },
}));

vi.mock('../cli/ui.js', () => ({ showConfigBox: vi.fn() }));
vi.mock('../cli/prompts.js', () => ({
  promptVideoSource: vi.fn(),
  promptContext: vi.fn(),
  promptOutputName: vi.fn().mockResolvedValue(undefined),
  promptConfirmation: vi.fn(),
}));
vi.mock('../cli/config.js', () => ({ resolveApiKey: vi.fn().mockResolvedValue('test-key') }));
vi.mock('../cli/progress.js', () => ({ createProgressDisplay: vi.fn(() => mockProgress) }));
vi.mock('../gemini/client.js', () => ({ GeminiClient: vi.fn() }));
vi.mock('../gemini/rate-limiter.js', () => ({ RateLimiter: vi.fn() }));
vi.mock('../gemini/models.js', () => ({
  MODELS: { flash: 'gemini-flash', pro: 'gemini-pro' },
}));

// Mock input handlers
vi.mock('../input/resolver.js', () => ({
  resolveInput: vi.fn().mockReturnValue({ type: 'local', value: '/tmp/video.mp4' }),
}));
vi.mock('../input/youtube.js', () => ({
  handleYouTube: vi.fn(),
  extractVideoId: vi.fn(),
  fetchYouTubeMetadata: vi.fn(),
}));
vi.mock('../input/local-file.js', () => ({
  handleLocalFile: vi.fn().mockResolvedValue({
    fileUri: 'file://test', mimeType: 'video/mp4', duration: 300, uploadedFileName: 'files/test',
  }),
  tryUnlink: vi.fn(),
}));
vi.mock('../input/remote.js', () => ({
  handleRemoteUrl: vi.fn(),
  downloadRemote: vi.fn(),
}));
vi.mock('../input/duration.js', () => ({
  detectDuration: vi.fn(),
}));

// Mock pipelines
vi.mock('../core/pipeline.js', () => ({
  runPipeline: (...args: unknown[]) => mockRunPipeline(args[0]),
}));
vi.mock('../core/clip-pipeline.js', () => ({
  runClipPipeline: (...args: unknown[]) => mockRunClipPipeline(args[0]),
}));

// Mock splitter
vi.mock('../core/splitter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/splitter.js')>();
  return {
    ...actual,
    splitVideo: mockSplitVideo,
    cleanupClips: mockCleanupClips,
  };
});

// Mock uploader
vi.mock('../core/clip-uploader.js', () => ({
  uploadClips: (...args: unknown[]) => mockUploadClips(...args),
}));

vi.mock('../output/generator.js', () => ({
  generateOutput: (...args: unknown[]) => mockGenerateOutput(args[0]),
  slugify: vi.fn().mockReturnValue('video'),
}));
vi.mock('../core/shutdown.js', () => ({
  createShutdownHandler: vi.fn(() => mockShutdownHandler),
}));

import { runDistill } from './distill.js';
import { detectDuration } from '../input/duration.js';
import { resolveInput } from '../input/resolver.js';

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

describe('distill clip pipeline routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateOutput.mockResolvedValue({ outputDir: '/tmp', filesGenerated: [], errors: [] });
    mockRunPipeline.mockResolvedValue(basePipelineResult());
    mockRunClipPipeline.mockResolvedValue(basePipelineResult());
  });

  it('routes short local files (300s) to standard pipeline', async () => {
    vi.mocked(detectDuration).mockResolvedValue(300);
    vi.mocked(resolveInput).mockReturnValue({ type: 'local', value: '/tmp/short.mp4' });

    await runDistill({ input: '/tmp/short.mp4', context: 'test', output: './out' });

    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
    expect(mockRunClipPipeline).not.toHaveBeenCalled();
    expect(mockSplitVideo).not.toHaveBeenCalled();
  });

  it('routes long local files (3600s) to clip pipeline', async () => {
    vi.mocked(detectDuration).mockResolvedValue(3600);
    vi.mocked(resolveInput).mockReturnValue({ type: 'local', value: '/tmp/long.mp4' });
    mockSplitVideo.mockResolvedValue([
      { index: 0, filePath: '/tmp/clip-0.mp4', startTime: 0, endTime: 1230, overlapDuration: 30 },
      { index: 1, filePath: '/tmp/clip-1.mp4', startTime: 1200, endTime: 2430, overlapDuration: 30 },
      { index: 2, filePath: '/tmp/clip-2.mp4', startTime: 2400, endTime: 3600, overlapDuration: 0 },
    ]);
    mockUploadClips.mockResolvedValue([
      { index: 0, fileUri: 'gs://0', mimeType: 'video/mp4', uploadedFileName: 'f0', globalStartTime: 0, globalEndTime: 1230, clipDuration: 1230, overlapDuration: 30 },
      { index: 1, fileUri: 'gs://1', mimeType: 'video/mp4', uploadedFileName: 'f1', globalStartTime: 1200, globalEndTime: 2430, clipDuration: 1230, overlapDuration: 30 },
      { index: 2, fileUri: 'gs://2', mimeType: 'video/mp4', uploadedFileName: 'f2', globalStartTime: 2400, globalEndTime: 3600, clipDuration: 1200, overlapDuration: 0 },
    ]);

    await runDistill({ input: '/tmp/long.mp4', context: 'test', output: './out' });

    expect(mockRunPipeline).not.toHaveBeenCalled();
    expect(mockRunClipPipeline).toHaveBeenCalledTimes(1);
    expect(mockSplitVideo).toHaveBeenCalledTimes(1);
  });

  it('cleans up clip temp files even if clip pipeline throws', async () => {
    vi.mocked(detectDuration).mockResolvedValue(3600);
    vi.mocked(resolveInput).mockReturnValue({ type: 'local', value: '/tmp/long.mp4' });
    mockSplitVideo.mockResolvedValue([
      { index: 0, filePath: '/tmp/clip-0.mp4', startTime: 0, endTime: 1230, overlapDuration: 30 },
    ]);
    mockUploadClips.mockRejectedValue(new Error('upload failed'));

    await expect(
      runDistill({ input: '/tmp/long.mp4', context: 'test', output: './out' }),
    ).rejects.toThrow('upload failed');

    expect(mockCleanupClips).toHaveBeenCalledTimes(1);
  });

  it('YouTube URLs always use standard pipeline regardless of duration', async () => {
    vi.mocked(resolveInput).mockReturnValue({ type: 'youtube', value: 'https://www.youtube.com/watch?v=test' });

    const { handleYouTube } = await import('../input/youtube.js');
    vi.mocked(handleYouTube).mockResolvedValue({
      fileUri: 'https://www.youtube.com/watch?v=test',
      mimeType: 'video/mp4',
      source: 'direct',
      duration: 7200,
    });
    vi.mocked(detectDuration).mockResolvedValue(7200); // 2 hours

    await runDistill({ input: 'https://www.youtube.com/watch?v=test', context: 'test', output: './out' });

    // YouTube videos are passed directly to Gemini — no splitting
    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
    expect(mockRunClipPipeline).not.toHaveBeenCalled();
    expect(mockSplitVideo).not.toHaveBeenCalled();
  });

  it('remote URL downloads then splits when duration is long', async () => {
    vi.mocked(resolveInput).mockReturnValue({ type: 'remote', value: 'https://bilibili.com/video/test' });

    const { downloadRemote } = await import('../input/remote.js');
    vi.mocked(downloadRemote).mockResolvedValue({
      filePath: '/tmp/remote-download.mp4',
      duration: 5400,
      title: 'Bilibili Video',
    });
    vi.mocked(detectDuration).mockResolvedValue(5400); // 90 min

    mockSplitVideo.mockResolvedValue([
      { index: 0, filePath: '/tmp/clip-0.mp4', startTime: 0, endTime: 1230, overlapDuration: 30 },
    ]);
    mockUploadClips.mockResolvedValue([
      { index: 0, fileUri: 'gs://0', mimeType: 'video/mp4', uploadedFileName: 'f0', globalStartTime: 0, globalEndTime: 1230, clipDuration: 1230, overlapDuration: 30 },
    ]);

    await runDistill({ input: 'https://bilibili.com/video/test', context: 'test', output: './out' });

    expect(mockRunClipPipeline).toHaveBeenCalledTimes(1);
    expect(mockSplitVideo).toHaveBeenCalledWith('/tmp/remote-download.mp4', expect.any(Array));
  });
});
