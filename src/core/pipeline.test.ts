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
vi.mock('./consensus.js', () => ({ runCodeConsensus: vi.fn() }));
vi.mock('./validator.js', () => ({ validateCodeReconstruction: vi.fn() }));

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
import { runCodeConsensus } from './consensus.js';
import type { ConsensusResult } from './consensus.js';
import { validateCodeReconstruction } from './validator.js';
import type { ValidationResult } from './validator.js';

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
const mockRunCodeConsensus = vi.mocked(runCodeConsensus);
const mockValidateCodeReconstruction = vi.mocked(validateCodeReconstruction);

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

function makeConsensusResult(overrides?: Partial<ConsensusResult>): ConsensusResult {
  return {
    confirmed: [],
    rejected: [],
    runsCompleted: 3,
    runsAttempted: 3,
    mergedDependencies: [],
    mergedBuildCommands: [],
    ...overrides,
  };
}

function makeValidationResult(overrides?: Partial<ValidationResult>): ValidationResult {
  return {
    confirmed: [],
    uncertain: [],
    rejected: [],
    warnings: [],
    ...overrides,
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
    }
    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult());
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult());
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
    }
    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult());
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult());
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
    }
    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult());
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult());
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
      mockRunChatExtraction.mockResolvedValueOnce(makeChatExtraction());
      mockRunImplicitSignals.mockResolvedValueOnce(makeImplicitSignals());
    }
    mockRunPeopleExtraction.mockResolvedValue(makePeopleExtraction());
    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult());
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult());
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
    }
    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult());
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult());
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
    }
    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult());
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult());
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

    const totalSteps = 6; // 3 segments × 2 passes

    // Segment 0 starts at index 2
    expect(progressCalls[2]).toEqual({ phase: 'pass1', segment: 0, totalSegments: 3, status: 'running', totalSteps });
    expect(progressCalls[3]).toEqual({ phase: 'pass1', segment: 0, totalSegments: 3, status: 'done', currentStep: 1, totalSteps });
    expect(progressCalls[4]).toEqual({ phase: 'pass2', segment: 0, totalSegments: 3, status: 'running', totalSteps });
    expect(progressCalls[5]).toEqual({ phase: 'pass2', segment: 0, totalSegments: 3, status: 'done', currentStep: 2, totalSteps });

    // Segment 1
    expect(progressCalls[6]).toEqual({ phase: 'pass1', segment: 1, totalSegments: 3, status: 'running', totalSteps });
    expect(progressCalls[7]).toEqual({ phase: 'pass1', segment: 1, totalSegments: 3, status: 'done', currentStep: 3, totalSteps });

    // Segment 2
    expect(progressCalls[10]).toEqual({ phase: 'pass1', segment: 2, totalSegments: 3, status: 'running', totalSteps });
    expect(progressCalls[13]).toEqual({ phase: 'pass2', segment: 2, totalSegments: 3, status: 'done', currentStep: 6, totalSteps });
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

  it('runs code consensus once (whole video) when strategy includes "code"', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }
    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult());
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult());
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    // Consensus runs exactly once (not per segment)
    expect(mockRunCodeConsensus).toHaveBeenCalledTimes(1);
    // pass3a is not in passesRun when codeReconstruction is null (empty confirmed+uncertain)
    expect(result.passesRun).not.toContain('pass3a');
    expect(result.codeReconstruction).toBeNull();
  });

  it('consensus called with { runs: 3, minAgreement: 2 } when strategy includes "code"', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }
    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult());
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult());
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    await promise;

    expect(mockRunCodeConsensus).toHaveBeenCalledTimes(1);
    const consensusArgs = mockRunCodeConsensus.mock.calls[0][0];
    expect(consensusArgs.config).toEqual({ runs: 3, minAgreement: 2 });
  });

  it('consensus receives pass2Results from all segments', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }
    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult());
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult());
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    await promise;

    const consensusArgs = mockRunCodeConsensus.mock.calls[0][0];
    expect(Array.isArray(consensusArgs.pass2Results)).toBe(true);
    expect((consensusArgs.pass2Results as unknown[]).length).toBe(3);
  });

  it('validation called after consensus with consensusResult and pass2Results', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }
    const consensusResult = makeConsensusResult({ runsCompleted: 3 });
    mockRunCodeConsensus.mockResolvedValue(consensusResult);
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult());
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    await promise;

    expect(mockValidateCodeReconstruction).toHaveBeenCalledTimes(1);
    const validationArgs = mockValidateCodeReconstruction.mock.calls[0][0];
    expect(validationArgs.consensusResult).toBe(consensusResult);
    expect(Array.isArray(validationArgs.pass2Results)).toBe(true);
    expect((validationArgs.pass2Results as unknown[]).length).toBe(3);
  });

  it('pipeline result includes both confirmed and uncertain files in codeReconstruction', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }

    const confirmedFile = {
      filename: 'src/main.ts',
      language: 'typescript',
      final_content: 'const x = 1;',
      changes: [{ timestamp: '0:00', change_type: 'add', description: 'init', diff_summary: '+1' }],
    };
    const uncertainFile = {
      filename: 'src/utils.ts',
      language: 'typescript',
      final_content: 'export function foo() {}',
      changes: [{ timestamp: '0:01', change_type: 'add', description: 'utils', diff_summary: '+1' }],
    };

    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult({ runsCompleted: 3 }));
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult({
      confirmed: [confirmedFile],
      uncertain: [uncertainFile],
    }));
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.codeReconstruction).not.toBeNull();
    expect(result.codeReconstruction?.files).toHaveLength(2);
    expect(result.codeReconstruction?.files).toContainEqual(confirmedFile);
    expect(result.codeReconstruction?.files).toContainEqual(uncertainFile);
    expect(result.passesRun).toContain('pass3a');
  });

  it('uncertain files included when 0 confirmed but >= 1 uncertain', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }

    const uncertainFile = {
      filename: 'src/utils.ts',
      language: 'typescript',
      final_content: 'export function foo() {}',
      changes: [{ timestamp: '0:01', change_type: 'add', description: 'utils', diff_summary: '+1' }],
    };

    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult({ runsCompleted: 2 }));
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult({
      confirmed: [],
      uncertain: [uncertainFile],
    }));
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.codeReconstruction).not.toBeNull();
    expect(result.codeReconstruction?.files).toHaveLength(1);
    expect(result.codeReconstruction?.files[0]).toEqual(uncertainFile);
    expect(result.passesRun).toContain('pass3a');
  });

  it('uncertainCodeFiles populated with uncertain file names', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }

    const uncertainFile = {
      filename: 'src/utils.ts',
      language: 'typescript',
      final_content: 'export function foo() {}',
      changes: [{ timestamp: '0:01', change_type: 'add', description: 'utils', diff_summary: '+1' }],
    };

    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult({ runsCompleted: 3 }));
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult({
      confirmed: [],
      uncertain: [uncertainFile],
    }));
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.uncertainCodeFiles).toEqual(['src/utils.ts']);
  });

  it('all consensus runs fail: codeReconstruction is null, error logged', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }
    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult({ runsCompleted: 0, runsAttempted: 3 }));
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    // Pipeline still completes
    expect(result.segments).toHaveLength(3);

    // Error recorded
    expect(result.errors.some(e => e.includes('pass3a'))).toBe(true);

    // Synthesis still ran
    expect(mockRunSynthesis).toHaveBeenCalledTimes(1);

    // codeReconstruction is null on failure
    expect(result.codeReconstruction).toBeNull();

    // Validation should not be called when all runs fail
    expect(mockValidateCodeReconstruction).not.toHaveBeenCalled();
  });

  it('code reconstruction result is on PipelineResult, not on SegmentResult', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }

    const confirmedFile = {
      filename: 'app.ts',
      language: 'typescript',
      final_content: 'const app = true;',
      changes: [{ timestamp: '0:00', change_type: 'add', description: 'app', diff_summary: '+1' }],
    };
    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult({ runsCompleted: 3 }));
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult({ confirmed: [confirmedFile] }));
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    // Result lives on PipelineResult
    expect(result.codeReconstruction).not.toBeNull();
    expect(result.codeReconstruction?.files).toContainEqual(confirmedFile);

    // No pass3a on any SegmentResult
    for (const seg of result.segments) {
      expect(seg).not.toHaveProperty('pass3a');
    }
  });

  it('code reconstruction runs after people extraction and before synthesis', async () => {
    const fullStrategy: PassStrategy = {
      passes: ['transcript', 'visual', 'people', 'code', 'synthesis'],
      resolution: 'medium',
      segmentMinutes: 10,
    };
    mockDetermineStrategy.mockReturnValue(fullStrategy);

    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }
    mockRunPeopleExtraction.mockResolvedValue(makePeopleExtraction());
    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult());
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult());
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    await promise;

    const peopleOrder = mockRunPeopleExtraction.mock.invocationCallOrder[0];
    const consensusOrder = mockRunCodeConsensus.mock.invocationCallOrder[0];
    const synthOrder = mockRunSynthesis.mock.invocationCallOrder[0];

    expect(peopleOrder).toBeLessThan(consensusOrder);
    expect(consensusOrder).toBeLessThan(synthOrder);
  });

  it('does not run code consensus when strategy does not include "code"', async () => {
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

    expect(mockRunCodeConsensus).not.toHaveBeenCalled();
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
    }
    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult());
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult());
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(mockRunSynthesis).toHaveBeenCalledTimes(1);
    expect(result.passesRun).toContain('synthesis');
    expect(result.synthesisResult).toEqual(makeSynthesisResult());

    // Synthesis must run after consensus
    const consensusOrder = mockRunCodeConsensus.mock.invocationCallOrder[0];
    const synthOrder = mockRunSynthesis.mock.invocationCallOrder[0];
    expect(consensusOrder).toBeLessThan(synthOrder);
  });

  it('synthesisResult includes files_to_generate', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }
    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult());
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult());
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
      mockRunChatExtraction.mockResolvedValueOnce(makeChatExtraction());
      mockRunImplicitSignals.mockResolvedValueOnce(makeImplicitSignals());
    }
    mockRunPeopleExtraction.mockResolvedValue(makePeopleExtraction());

    const confirmedFile = {
      filename: 'app.ts',
      language: 'typescript',
      final_content: 'const x = 1;',
      changes: [{ timestamp: '0:00', change_type: 'add', description: 'init', diff_summary: '+1' }],
    };
    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult({ runsCompleted: 3 }));
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult({ confirmed: [confirmedFile] }));
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
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }
    // All consensus runs fail
    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult({ runsCompleted: 0, runsAttempted: 3 }));
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    // Pipeline still completes
    expect(result.segments).toHaveLength(3);

    // Error recorded for the failing code pass
    expect(result.errors.some(e => e.includes('pass3a'))).toBe(true);

    // Synthesis still ran
    expect(mockRunSynthesis).toHaveBeenCalledTimes(1);

    // codeReconstruction is null on failure
    expect(result.codeReconstruction).toBeNull();
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

  it('progress events for pass3a show run 1/3, 2/3, 3/3 via segment/totalSegments', async () => {
    const progressCalls: ProgressStatus[] = [];
    const onProgress = (s: ProgressStatus) => { progressCalls.push(s); };

    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }

    // Simulate consensus calling onProgress for each run
    mockRunCodeConsensus.mockImplementation(async (params) => {
      params.onProgress?.(1, 3);
      params.onProgress?.(2, 3);
      params.onProgress?.(3, 3);
      return makeConsensusResult();
    });
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult());
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig({ onProgress }));
    await vi.runAllTimersAsync();
    await promise;

    const pass3aEvents = progressCalls.filter(p => p.phase === 'pass3a');
    // 3 pairs of (running + done) events, one per consensus run = 6 events total
    expect(pass3aEvents).toHaveLength(6);
    expect(pass3aEvents[0]).toMatchObject({ phase: 'pass3a', segment: 0, totalSegments: 3, status: 'running' });
    expect(pass3aEvents[1]).toMatchObject({ phase: 'pass3a', segment: 0, totalSegments: 3, status: 'done' });
    expect(pass3aEvents[2]).toMatchObject({ phase: 'pass3a', segment: 1, totalSegments: 3, status: 'running' });
    expect(pass3aEvents[3]).toMatchObject({ phase: 'pass3a', segment: 1, totalSegments: 3, status: 'done' });
    expect(pass3aEvents[4]).toMatchObject({ phase: 'pass3a', segment: 2, totalSegments: 3, status: 'running' });
    expect(pass3aEvents[5]).toMatchObject({ phase: 'pass3a', segment: 2, totalSegments: 3, status: 'done' });
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
    expect(pass3bEvents[0]).toMatchObject({ phase: 'pass3b', segment: 0, totalSegments: 1, status: 'running' });
    expect(pass3bEvents[1]).toMatchObject({ phase: 'pass3b', segment: 0, totalSegments: 1, status: 'done' });
  });

  it('synthesis uses MODELS.pro and does not pass fileUri/mimeType', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }
    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult());
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult());
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    await promise;

    const synthArgs = mockRunSynthesis.mock.calls[0][0];
    expect(synthArgs.model).toBe('gemini-2.5-pro');
    expect(synthArgs).not.toHaveProperty('fileUri');
    expect(synthArgs).not.toHaveProperty('mimeType');
  });

  it('synthesis failure records error and synthesisResult stays undefined', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }
    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult());
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult());
    mockRunSynthesis.mockRejectedValue(new Error('synthesis failed'));

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.errors.some(e => e.includes('synthesis failed'))).toBe(true);
    expect(result.synthesisResult).toBeUndefined();
    expect(result.passesRun).not.toContain('synthesis');
  });

  it('consensus runFn uses MODELS.pro for code reconstruction', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }

    // Capture and invoke runFn to verify it calls runCodeReconstruction with MODELS.pro
    mockRunCodeConsensus.mockImplementation(async (params) => {
      // Call the runFn to verify it passes correct args
      await params.runFn();
      return makeConsensusResult();
    });
    mockRunCodeReconstruction.mockResolvedValue(makeCodeReconstruction());
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult());
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    await promise;

    expect(mockRunCodeReconstruction).toHaveBeenCalledTimes(1);
    const codeArgs = mockRunCodeReconstruction.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(codeArgs['model']).toBe('gemini-2.5-pro');
  });

  it('interrupted pipeline lists pass3a in interruptedPasses when code strategy is active', async () => {
    let callCount = 0;
    mockRunTranscript.mockImplementation(async () => {
      callCount++;
      if (callCount >= 2) {
        // Simulate shutdown after first segment
        return makePass1(0);
      }
      return makePass1(0);
    });
    mockRunVisual.mockResolvedValue(makePass2(0));

    let shutdownTriggered = false;
    const isShuttingDown = () => {
      // Trigger shutdown after first segment completes
      if (callCount >= 1) {
        shutdownTriggered = true;
        return true;
      }
      return false;
    };

    // Reset and use a simpler approach
    vi.clearAllMocks();
    mockRunSceneAnalysis.mockResolvedValue(MOCK_PROFILE);
    mockDetermineStrategy.mockReturnValue(MOCK_STRATEGY);
    mockCreateSegmentPlan.mockReturnValue({
      segments: SEGMENTS,
      resolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
    });

    let segmentsDone = 0;
    mockRunTranscript.mockImplementation(async () => {
      segmentsDone++;
      return makePass1(segmentsDone - 1);
    });
    mockRunVisual.mockImplementation(async () => makePass2(0));

    const isShuttingDownFn = () => segmentsDone >= 1;

    const promise = runPipeline(baseConfig({ isShuttingDown: isShuttingDownFn }));
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.interrupted).toBeDefined();
    expect(result.interrupted).toContain('pass3a');
  });

  it('does not log code validation summary (hidden from user output)', async () => {
    for (let i = 0; i < 3; i++) {
      mockRunTranscript.mockResolvedValueOnce(makePass1(i));
      mockRunVisual.mockResolvedValueOnce(makePass2(i));
    }

    const confirmedFile = {
      filename: 'src/main.ts',
      language: 'typescript',
      final_content: 'const x = 1;',
      changes: [{ timestamp: '0:00', change_type: 'add', description: 'init', diff_summary: '+1' }],
    };
    const uncertainFile = {
      filename: 'src/utils.ts',
      language: 'typescript',
      final_content: 'export function foo() {}',
      changes: [{ timestamp: '0:01', change_type: 'add', description: 'utils', diff_summary: '+1' }],
    };
    const rejectedFile = {
      filename: '../bad.ts',
      language: 'typescript',
      final_content: 'malicious',
      changes: [{ timestamp: '0:02', change_type: 'add', description: 'bad', diff_summary: '+1' }],
    };

    mockRunCodeConsensus.mockResolvedValue(makeConsensusResult({ runsCompleted: 3 }));
    mockValidateCodeReconstruction.mockReturnValue(makeValidationResult({
      confirmed: [confirmedFile],
      uncertain: [uncertainFile],
      rejected: [rejectedFile],
    }));
    mockRunSynthesis.mockResolvedValue(makeSynthesisResult());

    // Spy on log.info
    const { log } = await import('@clack/prompts');
    const logInfoSpy = vi.spyOn(log, 'info');

    const promise = runPipeline(baseConfig());
    await vi.runAllTimersAsync();
    await promise;

    const summaryCall = logInfoSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].startsWith('Code:')
    );
    expect(summaryCall).toBeUndefined();

    logInfoSpy.mockRestore();
  });
});
