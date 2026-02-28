import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPipeline } from './pipeline.js';
import type { Pass1Result, Pass2Result, ProgressStatus, VideoProfile, PassStrategy, Segment, CodeReconstruction, ChatExtraction, ImplicitSignals, PeopleExtraction, SynthesisResult } from '../types/index.js';
import type { GeminiClient } from '../gemini/client.js';
import { RateLimiter } from '../gemini/rate-limiter.js';
import { MediaResolution } from '@google/genai';

vi.mock('../passes/transcript.js', () => ({ runTranscript: vi.fn() }));
vi.mock('../passes/visual.js', () => ({ runVisual: vi.fn() }));
vi.mock('../passes/scene-analysis.js', () => ({ runSceneAnalysis: vi.fn() }));
vi.mock('../passes/code.js', () => ({ runCodeReconstruction: vi.fn() }));
vi.mock('../passes/people.js', () => ({ runPeopleExtraction: vi.fn() }));
vi.mock('../passes/chat.js', () => ({ runChatExtraction: vi.fn() }));
vi.mock('../passes/implicit.js', () => ({ runImplicitSignals: vi.fn() }));
vi.mock('../passes/synthesis.js', () => ({ runSynthesis: vi.fn() }));
vi.mock('./strategy.js', () => ({ determineStrategy: vi.fn() }));
vi.mock('./segmenter.js', () => ({ createSegmentPlan: vi.fn() }));

import { runTranscript } from '../passes/transcript.js';
import { runVisual } from '../passes/visual.js';
import { runSceneAnalysis } from '../passes/scene-analysis.js';
import { runCodeReconstruction } from '../passes/code.js';
import { runPeopleExtraction } from '../passes/people.js';
import { runChatExtraction } from '../passes/chat.js';
import { runImplicitSignals } from '../passes/implicit.js';
import { runSynthesis } from '../passes/synthesis.js';
import { determineStrategy } from './strategy.js';
import { createSegmentPlan } from './segmenter.js';

const mockRunTranscript = vi.mocked(runTranscript);
const mockRunVisual = vi.mocked(runVisual);
const mockRunSceneAnalysis = vi.mocked(runSceneAnalysis);
const mockRunCodeReconstruction = vi.mocked(runCodeReconstruction);
const mockRunPeopleExtraction = vi.mocked(runPeopleExtraction);
const mockRunChatExtraction = vi.mocked(runChatExtraction);
const mockRunImplicitSignals = vi.mocked(runImplicitSignals);
const mockRunSynthesis = vi.mocked(runSynthesis);
const mockDetermineStrategy = vi.mocked(determineStrategy);
const mockCreateSegmentPlan = vi.mocked(createSegmentPlan);

const MOCK_PROFILE: VideoProfile = {
  type: 'coding',
  speakers: { count: 1, identified: [] },
  visualContent: {
    hasCode: true,
    hasSlides: false,
    hasDiagrams: false,
    hasPeopleGrid: false,
    hasChatbox: false,
    hasWhiteboard: false,
    hasTerminal: false,
    hasScreenShare: false,
  },
  audioContent: { hasMultipleSpeakers: false, primaryLanguage: 'en', quality: 'high' },
  complexity: 'moderate',
  recommendations: { resolution: 'medium', segmentMinutes: 10, passes: ['transcript', 'visual', 'code', 'synthesis'] },
};

const MOCK_STRATEGY: PassStrategy = {
  passes: ['transcript', 'visual', 'code', 'synthesis'],
  resolution: 'medium',
  segmentMinutes: 10,
};

const SEGMENTS: Segment[] = [
  { index: 0, startTime: 0, endTime: 600 },
  { index: 1, startTime: 600, endTime: 1200 },
  { index: 2, startTime: 1200, endTime: 1800 },
];

function makePass1(segmentIndex: number): Pass1Result {
  return {
    segment_index: segmentIndex,
    time_range: `${segmentIndex * 600}s - ${(segmentIndex + 1) * 600}s`,
    transcript_entries: [
      { timestamp: '00:00:01', speaker: 'SPEAKER_00', text: `Hello from segment ${segmentIndex}`, tone: 'neutral' },
    ],
    speaker_summary: [{ speaker_id: 'SPEAKER_00', description: 'Main speaker' }],
  };
}

function makePass2(segmentIndex: number): Pass2Result {
  return {
    segment_index: segmentIndex,
    time_range: `${segmentIndex * 600}s - ${(segmentIndex + 1) * 600}s`,
    code_blocks: [],
    visual_notes: [],
    screen_timeline: [],
  };
}

function makeCodeReconstruction(): CodeReconstruction {
  return { files: [], dependencies_mentioned: [], build_commands: [] };
}

function makeChatExtraction(): ChatExtraction {
  return { messages: [], links: [] };
}

function makeImplicitSignals(): ImplicitSignals {
  return {
    emotional_shifts: [],
    questions_implicit: [],
    decisions_implicit: [],
    tasks_assigned: [],
    emphasis_patterns: [],
  };
}

function makePeopleExtraction(): PeopleExtraction {
  return { participants: [], relationships: [] };
}

function makeSynthesisResult(): SynthesisResult {
  return {
    overview: 'test overview',
    key_decisions: [],
    key_concepts: [],
    action_items: [],
    questions_raised: [],
    suggestions: [],
    topics: [],
    files_to_generate: ['README.md'],
  };
}

function makeClient(): GeminiClient {
  return { generate: vi.fn() } as unknown as GeminiClient;
}

function makeRateLimiter(): RateLimiter {
  return new RateLimiter({ minDelay: 0, initialDelay: 0 });
}

function baseConfig(overrides?: object) {
  return {
    client: makeClient(),
    fileUri: 'files/test123',
    mimeType: 'video/mp4',
    duration: 1800,
    model: 'gemini-2.5-flash',
    rateLimiter: makeRateLimiter(),
    ...overrides,
  };
}

describe('runPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Default happy-path mocks
    mockRunSceneAnalysis.mockResolvedValue(MOCK_PROFILE);
    mockDetermineStrategy.mockReturnValue(MOCK_STRATEGY);
    mockCreateSegmentPlan.mockReturnValue({
      segments: SEGMENTS,
      resolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
    });
  });

  it('runs Pass 0 first before any segment passes', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
      mockRunCodeReconstruction.mockResolvedValueOnce(makeCodeReconstruction());
    }
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    await promise;

    // Pass 0 must have been called
    expect(mockRunSceneAnalysis).toHaveBeenCalledTimes(1);

    // Pass 0 should be called before transcript/visual
    const pass0Order = mockRunSceneAnalysis.mock.invocationCallOrder[0];
    const firstTranscriptOrder = mockRunTranscript.mock.invocationCallOrder[0];
    expect(pass0Order).toBeLessThan(firstTranscriptOrder);
  });

  it('returns videoProfile and strategy in result', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
      mockRunCodeReconstruction.mockResolvedValueOnce(makeCodeReconstruction());
    }
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.videoProfile).toEqual(MOCK_PROFILE);
    expect(result.strategy).toEqual(MOCK_STRATEGY);
  });

  it('coding type: strategy passes contain transcript, visual, code, synthesis', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
      mockRunCodeReconstruction.mockResolvedValueOnce(makeCodeReconstruction());
    }
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const codingStrategy: PassStrategy = {
      passes: ['transcript', 'visual', 'code', 'synthesis'],
      resolution: 'medium',
      segmentMinutes: 10,
    };
    mockDetermineStrategy.mockReturnValue(codingStrategy);

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.strategy?.passes).toEqual(['transcript', 'visual', 'code', 'synthesis']);
  });

  it('uses DEFAULT_PROFILE when Pass 0 fails and strategy still works', async () => {
    const error = new Error('scene analysis failed');
    mockRunSceneAnalysis.mockRejectedValue(error);

    // determineStrategy is still called with the default profile
    const fallbackStrategy: PassStrategy = {
      passes: ['transcript', 'visual', 'code', 'people', 'chat', 'implicit', 'synthesis'],
      resolution: 'medium',
      segmentMinutes: 10,
    };
    mockDetermineStrategy.mockReturnValue(fallbackStrategy);

    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
      mockRunCodeReconstruction.mockResolvedValueOnce(makeCodeReconstruction());
      mockRunChatExtraction.mockResolvedValueOnce(makeChatExtraction());
      mockRunImplicitSignals.mockResolvedValueOnce(makeImplicitSignals());
    }
    mockRunPeopleExtraction.mockResolvedValue(makePeopleExtraction());
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    // Should have an error recorded for pass0
    expect(result.errors.some(e => e.includes('pass0 failed'))).toBe(true);

    // Strategy was still determined (using default profile)
    expect(mockDetermineStrategy).toHaveBeenCalledTimes(1);
    const profileArg = mockDetermineStrategy.mock.calls[0][0];
    expect(profileArg.type).toBe('mixed');
    expect(profileArg.complexity).toBe('moderate');

    // Strategy is still present in result
    expect(result.strategy).toEqual(fallbackStrategy);

    // Segments still processed
    expect(result.segments).toHaveLength(3);
  });

  it('calls onProgress with pass0 status before segment passes', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
      mockRunCodeReconstruction.mockResolvedValueOnce(makeCodeReconstruction());
    }
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const progressCalls: ProgressStatus[] = [];
    const onProgress = (s: ProgressStatus) => { progressCalls.push(s); };

    const promise = runPipeline(baseConfig({ onProgress }));
    await vi.runAllTimersAsync();
    await promise;

    // First two calls should be pass0 running and done
    expect(progressCalls[0]).toEqual({ phase: 'pass0', segment: 0, totalSegments: 1, status: 'running' });
    expect(progressCalls[1]).toEqual({ phase: 'pass0', segment: 0, totalSegments: 1, status: 'done' });

    // Subsequent calls are for segment passes
    expect(progressCalls[2].phase).toBe('pass1');
  });

  it('processes all 3 segments sequentially: pass1 then pass2 for each, no specialist passes when not in strategy', async () => {
    const noSpecialistStrategy: PassStrategy = {
      passes: ['transcript', 'visual'],
      resolution: 'medium',
      segmentMinutes: 10,
    };
    mockDetermineStrategy.mockReturnValue(noSpecialistStrategy);

    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.segments).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(result.passesRun).toEqual(['pass1', 'pass2']);

    for (let i = 0; i < 3; i++) {
      expect(result.segments[i].index).toBe(i);
      expect(result.segments[i].pass1).toEqual(makePass1(i));
      expect(result.segments[i].pass2).toEqual(makePass2(i));
    }

    // Verify pass1 was always called before pass2 for each segment
    const calls = mockRunTranscript.mock.invocationCallOrder;
    const visualCalls = mockRunVisual.mock.invocationCallOrder;
    for (let i = 0; i < 3; i++) {
      expect(calls[i]).toBeLessThan(visualCalls[i]);
    }
  });

  it('sets pass1 to null and runs pass2 with undefined transcript when pass1 fails after 4 attempts for segment 1', async () => {
    const noSpecialistStrategy: PassStrategy = {
      passes: ['transcript', 'visual'],
      resolution: 'medium',
      segmentMinutes: 10,
    };
    mockDetermineStrategy.mockReturnValue(noSpecialistStrategy);

    const error = new Error('network failure');

    // segment 0: success
    mockRunTranscript.mockResolvedValueOnce(makePass1(0));
    mockRunVisual.mockResolvedValueOnce(makePass2(0));

    // segment 1 pass1: fail 4 times (initial + 3 retries)
    mockRunTranscript.mockRejectedValueOnce(error);
    mockRunTranscript.mockRejectedValueOnce(error);
    mockRunTranscript.mockRejectedValueOnce(error);
    mockRunTranscript.mockRejectedValueOnce(error);
    // segment 1 pass2: success (with no transcript)
    mockRunVisual.mockResolvedValueOnce(makePass2(1));

    // segment 2: success
    mockRunTranscript.mockResolvedValueOnce(makePass1(2));
    mockRunVisual.mockResolvedValueOnce(makePass2(2));

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.segments).toHaveLength(3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/segment 1 pass1 failed after 4 attempts/);

    expect(result.segments[1].pass1).toBeNull();
    expect(result.segments[1].pass2).toEqual(makePass2(1));

    // pass2 for segment 1 should have been called with pass1Transcript: undefined
    const pass2Calls = mockRunVisual.mock.calls;
    expect(pass2Calls[1][0].pass1Transcript).toBeUndefined();
  });

  it('returns empty errors array when all passes succeed', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
      mockRunCodeReconstruction.mockResolvedValueOnce(makeCodeReconstruction());
    }
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.errors).toEqual([]);
    expect(result.segments.every(s => s.pass1 !== null && s.pass2 !== null)).toBe(true);
  });

  it('calls onProgress with correct status for each pass start and completion (pass1+pass2 only strategy)', async () => {
    const noSpecialistStrategy: PassStrategy = {
      passes: ['transcript', 'visual'],
      resolution: 'medium',
      segmentMinutes: 10,
    };
    mockDetermineStrategy.mockReturnValue(noSpecialistStrategy);

    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }

    const progressCalls: ProgressStatus[] = [];
    const onProgress = (s: ProgressStatus) => { progressCalls.push(s); };

    const promise = runPipeline(baseConfig({ onProgress }));
    await vi.runAllTimersAsync();
    await promise;

    // 2 (pass0) + 3 segments × 2 passes × 2 events (running + done) = 14 calls total
    expect(progressCalls).toHaveLength(14);

    // pass0 events at index 0 and 1
    expect(progressCalls[0]).toEqual({ phase: 'pass0', segment: 0, totalSegments: 1, status: 'running' });
    expect(progressCalls[1]).toEqual({ phase: 'pass0', segment: 0, totalSegments: 1, status: 'done' });

    // Segment 0 starts at index 2
    expect(progressCalls[2]).toEqual({ phase: 'pass1', segment: 0, totalSegments: 3, status: 'running' });
    expect(progressCalls[3]).toEqual({ phase: 'pass1', segment: 0, totalSegments: 3, status: 'done' });
    expect(progressCalls[4]).toEqual({ phase: 'pass2', segment: 0, totalSegments: 3, status: 'running' });
    expect(progressCalls[5]).toEqual({ phase: 'pass2', segment: 0, totalSegments: 3, status: 'done' });

    // Segment 1
    expect(progressCalls[6]).toEqual({ phase: 'pass1', segment: 1, totalSegments: 3, status: 'running' });
    expect(progressCalls[7]).toEqual({ phase: 'pass1', segment: 1, totalSegments: 3, status: 'done' });

    // Segment 2
    expect(progressCalls[10]).toEqual({ phase: 'pass1', segment: 2, totalSegments: 3, status: 'running' });
    expect(progressCalls[13]).toEqual({ phase: 'pass2', segment: 2, totalSegments: 3, status: 'done' });
  });

  it('passesRun contains only pass1 and pass2 when strategy has no specialist passes', async () => {
    const noSpecialistStrategy: PassStrategy = {
      passes: ['transcript', 'visual'],
      resolution: 'medium',
      segmentMinutes: 10,
    };
    mockDetermineStrategy.mockReturnValue(noSpecialistStrategy);

    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.passesRun).toEqual(['pass1', 'pass2']);
  });

  // --- Specialist pass dispatch tests ---

  it('runs code reconstruction per segment when strategy includes "code"', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
      mockRunCodeReconstruction.mockResolvedValueOnce(makeCodeReconstruction());
    }
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(mockRunCodeReconstruction).toHaveBeenCalledTimes(3);
    expect(result.passesRun).toContain('pass3a');
    for (let i = 0; i < 3; i++) {
      expect(result.segments[i].pass3a).toEqual(makeCodeReconstruction());
    }
  });

  it('does not run code reconstruction when strategy does not include "code"', async () => {
    const noCodeStrategy: PassStrategy = {
      passes: ['transcript', 'visual'],
      resolution: 'medium',
      segmentMinutes: 10,
    };
    mockDetermineStrategy.mockReturnValue(noCodeStrategy);

    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(mockRunCodeReconstruction).not.toHaveBeenCalled();
    expect(result.passesRun).not.toContain('pass3a');
  });

  it('runs people extraction once after all segments when strategy includes "people"', async () => {
    const peopleStrategy: PassStrategy = {
      passes: ['transcript', 'visual', 'people'],
      resolution: 'medium',
      segmentMinutes: 10,
    };
    mockDetermineStrategy.mockReturnValue(peopleStrategy);

    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }
    mockRunPeopleExtraction.mockResolvedValue(makePeopleExtraction());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    // People extraction runs exactly once (not per segment)
    expect(mockRunPeopleExtraction).toHaveBeenCalledTimes(1);
    expect(result.passesRun).toContain('pass3b');
    expect(result.peopleExtraction).toEqual(makePeopleExtraction());

    // It runs after all segments (all transcript calls already happened)
    const lastTranscriptOrder = mockRunTranscript.mock.invocationCallOrder[2];
    const peopleOrder = mockRunPeopleExtraction.mock.invocationCallOrder[0];
    expect(lastTranscriptOrder).toBeLessThan(peopleOrder);
  });

  it('people extraction receives all pass1Results from segments', async () => {
    const peopleStrategy: PassStrategy = {
      passes: ['transcript', 'visual', 'people'],
      resolution: 'medium',
      segmentMinutes: 10,
    };
    mockDetermineStrategy.mockReturnValue(peopleStrategy);

    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }
    mockRunPeopleExtraction.mockResolvedValue(makePeopleExtraction());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    await promise;

    const callArgs = mockRunPeopleExtraction.mock.calls[0][0];
    expect(callArgs.pass1Results).toHaveLength(3);
    expect(callArgs.pass1Results[0]).toEqual(makePass1(0));
    expect(callArgs.pass1Results[1]).toEqual(makePass1(1));
    expect(callArgs.pass1Results[2]).toEqual(makePass1(2));
  });

  it('synthesis runs last after all extraction passes', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
      mockRunCodeReconstruction.mockResolvedValueOnce(makeCodeReconstruction());
    }
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(mockRunSynthesis).toHaveBeenCalledTimes(1);
    expect(result.passesRun).toContain('synthesis');
    expect(result.synthesisResult).toEqual(makeSynthesisResult());

    // Synthesis must run after the last code reconstruction
    const lastCodeOrder = mockRunCodeReconstruction.mock.invocationCallOrder[2];
    const synthOrder = mockRunSynthesis.mock.invocationCallOrder[0];
    expect(lastCodeOrder).toBeLessThan(synthOrder);
  });

  it('synthesisResult includes files_to_generate', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
      mockRunCodeReconstruction.mockResolvedValueOnce(makeCodeReconstruction());
    }
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.synthesisResult?.files_to_generate).toEqual(['README.md']);
  });

  it('passesRun dynamically includes all passes that ran', async () => {
    const fullStrategy: PassStrategy = {
      passes: ['transcript', 'visual', 'code', 'people', 'chat', 'implicit', 'synthesis'],
      resolution: 'medium',
      segmentMinutes: 10,
    };
    mockDetermineStrategy.mockReturnValue(fullStrategy);

    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
      mockRunCodeReconstruction.mockResolvedValueOnce(makeCodeReconstruction());
      mockRunChatExtraction.mockResolvedValueOnce(makeChatExtraction());
      mockRunImplicitSignals.mockResolvedValueOnce(makeImplicitSignals());
    }
    mockRunPeopleExtraction.mockResolvedValue(makePeopleExtraction());
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.passesRun).toContain('pass1');
    expect(result.passesRun).toContain('pass2');
    expect(result.passesRun).toContain('pass3a');
    expect(result.passesRun).toContain('pass3b');
    expect(result.passesRun).toContain('pass3c');
    expect(result.passesRun).toContain('pass3d');
    expect(result.passesRun).toContain('synthesis');
  });

  it('specialist pass failure is captured in errors and pipeline continues', async () => {
    const codeError = new Error('code pass failed');

    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
      // code reconstruction fails for all attempts on every segment
      mockRunCodeReconstruction.mockRejectedValue(codeError);
    }
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    // Pipeline still completes
    expect(result.segments).toHaveLength(3);

    // Errors recorded for each failing code pass (4 attempts × 3 segments = many rejections, but 3 error entries)
    expect(result.errors.some(e => e.includes('pass3a'))).toBe(true);

    // Synthesis still ran
    expect(mockRunSynthesis).toHaveBeenCalledTimes(1);

    // pass3a in segments is null on failure
    for (let i = 0; i < 3; i++) {
      expect(result.segments[i].pass3a).toBeNull();
    }
  });

  it('people extraction failure is captured in errors, pipeline continues, synthesis still runs', async () => {
    const fullStrategy: PassStrategy = {
      passes: ['transcript', 'visual', 'people', 'synthesis'],
      resolution: 'medium',
      segmentMinutes: 10,
    };
    mockDetermineStrategy.mockReturnValue(fullStrategy);

    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }
    mockRunPeopleExtraction.mockRejectedValue(new Error('people pass failed'));
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.errors.some(e => e.includes('pass3b'))).toBe(true);
    expect(result.segments).toHaveLength(3);
    expect(mockRunSynthesis).toHaveBeenCalledTimes(1);
    expect(result.peopleExtraction).toBeNull();
  });

  it('progress events emitted for pass3a per segment', async () => {
    const progressCalls: ProgressStatus[] = [];
    const onProgress = (s: ProgressStatus) => { progressCalls.push(s); };

    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
      mockRunCodeReconstruction.mockResolvedValueOnce(makeCodeReconstruction());
    }
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig({ onProgress }));
    await vi.runAllTimersAsync();
    await promise;

    const pass3aEvents = progressCalls.filter(p => p.phase === 'pass3a');
    expect(pass3aEvents).toHaveLength(6); // 3 segments × 2 events (running + done)
    expect(pass3aEvents[0]).toEqual({ phase: 'pass3a', segment: 0, totalSegments: 3, status: 'running' });
    expect(pass3aEvents[1]).toEqual({ phase: 'pass3a', segment: 0, totalSegments: 3, status: 'done' });
  });

  it('progress events emitted for pass3b once', async () => {
    const fullStrategy: PassStrategy = {
      passes: ['transcript', 'visual', 'people'],
      resolution: 'medium',
      segmentMinutes: 10,
    };
    mockDetermineStrategy.mockReturnValue(fullStrategy);

    const progressCalls: ProgressStatus[] = [];
    const onProgress = (s: ProgressStatus) => { progressCalls.push(s); };

    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }
    mockRunPeopleExtraction.mockResolvedValue(makePeopleExtraction());

    const promise = runPipeline(baseConfig({ onProgress }));
    await vi.runAllTimersAsync();
    await promise;

    const pass3bEvents = progressCalls.filter(p => p.phase === 'pass3b');
    expect(pass3bEvents).toHaveLength(2); // running + done
    expect(pass3bEvents[0]).toEqual({ phase: 'pass3b', segment: 0, totalSegments: 1, status: 'running' });
    expect(pass3bEvents[1]).toEqual({ phase: 'pass3b', segment: 0, totalSegments: 1, status: 'done' });
  });

  it('synthesis uses MODELS[1].id and does not pass fileUri/mimeType', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
      mockRunCodeReconstruction.mockResolvedValueOnce(makeCodeReconstruction());
    }
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    await promise;

    const synthArgs = mockRunSynthesis.mock.calls[0][0];
    expect(synthArgs.model).toBe('gemini-2.5-flash');
    expect(synthArgs).not.toHaveProperty('fileUri');
    expect(synthArgs).not.toHaveProperty('mimeType');
  });

  it('synthesis failure records error and synthesisResult stays undefined', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
      mockRunCodeReconstruction.mockResolvedValueOnce(makeCodeReconstruction());
    }
    mockRunSynthesis.mockRejectedValue(new Error('synthesis failed'));

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.errors.some(e => e.includes('synthesis failed'))).toBe(true);
    expect(result.synthesisResult).toBeUndefined();
    expect(result.passesRun).not.toContain('synthesis');
  });

  it('code reconstruction uses MODELS[0].id', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
      mockRunCodeReconstruction.mockResolvedValueOnce(makeCodeReconstruction());
    }
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    await promise;

    const codeArgs = mockRunCodeReconstruction.mock.calls[0][0];
    expect(codeArgs.model).toBe('gemini-3-flash-preview');
  });
});
