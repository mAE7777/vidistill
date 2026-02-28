import { describe, it, expect } from 'vitest';
import { writeGuide } from './guide.js';
import type { PipelineResult, SynthesisResult, VideoProfile } from '../types/index.js';

function makePipelineResult(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
    segments: [],
    passesRun: [],
    errors: [],
    ...overrides,
  };
}

const SYNTHESIS: SynthesisResult = {
  overview: 'A video about TypeScript basics.',
  key_decisions: [],
  key_concepts: [],
  action_items: [],
  questions_raised: [],
  suggestions: ['Try the examples', 'Review the docs'],
  topics: [],
  files_to_generate: ['src/index.ts', 'tsconfig.json'],
};

const PROFILE: VideoProfile = {
  type: 'coding',
  speakers: { count: 1, identified: ['Instructor'] },
  visualContent: {
    hasCode: true,
    hasSlides: false,
    hasDiagrams: false,
    hasPeopleGrid: false,
    hasChatbox: false,
    hasWhiteboard: false,
    hasTerminal: true,
    hasScreenShare: false,
  },
  audioContent: { hasMultipleSpeakers: false, primaryLanguage: 'en', quality: 'high' },
  complexity: 'moderate',
  recommendations: { resolution: 'medium', segmentMinutes: 10, passes: ['transcript', 'visual', 'code'] },
};

describe('writeGuide', () => {
  it('contains title in output', () => {
    const result = writeGuide({
      title: 'TypeScript Tutorial',
      source: 'example/test.mp4',
      duration: 600,
      pipelineResult: makePipelineResult({ synthesisResult: SYNTHESIS }),
    });
    expect(result).toContain('# TypeScript Tutorial');
  });

  it('contains source path', () => {
    const result = writeGuide({
      title: 'Test',
      source: 'example/test.mp4',
      duration: 600,
      pipelineResult: makePipelineResult(),
    });
    expect(result).toContain('example/test.mp4');
  });

  it('contains formatted duration', () => {
    const result = writeGuide({
      title: 'Test',
      source: 'example/test.mp4',
      duration: 330, // 5m 30s
      pipelineResult: makePipelineResult(),
    });
    expect(result).toContain('5m 30s');
  });

  it('contains video type from profile', () => {
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 60,
      pipelineResult: makePipelineResult({ videoProfile: PROFILE }),
    });
    expect(result).toContain('coding');
  });

  it('shows "unknown" type when no profile', () => {
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 60,
      pipelineResult: makePipelineResult(),
    });
    expect(result).toContain('unknown');
  });

  it('contains files table with synthesis files', () => {
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 60,
      pipelineResult: makePipelineResult({ synthesisResult: SYNTHESIS }),
    });
    expect(result).toContain('src/index.ts');
    expect(result).toContain('tsconfig.json');
  });

  it('shows placeholder when no files to generate', () => {
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 60,
      pipelineResult: makePipelineResult({
        synthesisResult: { ...SYNTHESIS, files_to_generate: [] },
      }),
    });
    expect(result).toContain('No files identified');
  });

  it('contains summary from synthesis overview', () => {
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 60,
      pipelineResult: makePipelineResult({ synthesisResult: SYNTHESIS }),
    });
    expect(result).toContain('A video about TypeScript basics.');
  });

  it('shows placeholder summary when no synthesis', () => {
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 60,
      pipelineResult: makePipelineResult(),
    });
    expect(result).toContain('No summary available');
  });

  it('contains suggestions from synthesis', () => {
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 60,
      pipelineResult: makePipelineResult({ synthesisResult: SYNTHESIS }),
    });
    expect(result).toContain('Try the examples');
    expect(result).toContain('Review the docs');
  });

  it('shows placeholder when no suggestions', () => {
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 60,
      pipelineResult: makePipelineResult({
        synthesisResult: { ...SYNTHESIS, suggestions: [] },
      }),
    });
    expect(result).toContain('No suggestions');
  });

  it('contains processing details with passes run', () => {
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 60,
      pipelineResult: makePipelineResult({ passesRun: ['pass1', 'pass2'] }),
    });
    expect(result).toContain('pass1');
    expect(result).toContain('pass2');
  });

  it('does not show incomplete passes section when no errors', () => {
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 60,
      pipelineResult: makePipelineResult({ errors: [] }),
    });
    expect(result).not.toContain('Incomplete Passes');
  });

  it('shows incomplete passes section when there are errors', () => {
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 60,
      pipelineResult: makePipelineResult({ errors: ['segment 0 pass1 failed after 4 attempts: timeout'] }),
    });
    expect(result).toContain('Incomplete Passes');
    expect(result).toContain('segment 0 pass1 failed');
  });

  it('returns a string', () => {
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 0,
      pipelineResult: makePipelineResult(),
    });
    expect(typeof result).toBe('string');
  });
});
