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
  prerequisites: [],
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

  it('contains files table with actually generated files', () => {
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 60,
      pipelineResult: makePipelineResult({ synthesisResult: SYNTHESIS }),
      filesGenerated: ['transcript.md', 'notes.md', 'code/src/index.ts'],
    });
    expect(result).toContain('transcript.md');
    expect(result).toContain('code/src/index.ts');
  });

  it('shows placeholder when no files generated', () => {
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 60,
      pipelineResult: makePipelineResult({
        synthesisResult: { ...SYNTHESIS, files_to_generate: [] },
      }),
    });
    expect(result).toContain('No files generated');
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

  it('contains prerequisites section when prerequisites exist', () => {
    const synthWithPrereqs = {
      ...SYNTHESIS,
      prerequisites: [
        { concept: 'TypeScript Basics', assumed_knowledge_level: 'intermediate' as const, brief_explanation: 'Familiarity with TS types', timestamp_first_assumed: '00:02:00' },
        { concept: 'Node.js', assumed_knowledge_level: 'basic' as const, brief_explanation: 'Know how to run node', timestamp_first_assumed: '00:05:00' },
      ],
    };
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 60,
      pipelineResult: makePipelineResult({ synthesisResult: synthWithPrereqs }),
    });
    expect(result).toContain('## Prerequisites');
    expect(result).toContain('TypeScript Basics');
    expect(result).toContain('Familiarity with TS types');
    expect(result).toContain('Node.js');
    expect(result).toContain('### Intermediate Knowledge');
    expect(result).toContain('### Basic Knowledge');
  });

  it('does not show prerequisites section when none exist', () => {
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 60,
      pipelineResult: makePipelineResult({ synthesisResult: SYNTHESIS }),
    });
    expect(result).not.toContain('## Prerequisites');
  });

  it('shows images/ summary row when filesGenerated includes image entries', () => {
    const imageFiles = Array.from({ length: 15 }, (_, i) => `images/frame-00-00-${String(i).padStart(2, '0')}.png`);
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 60,
      pipelineResult: makePipelineResult(),
      filesGenerated: ['transcript.md', ...imageFiles],
    });
    expect(result).toContain('| images/ (15 frames) |');
  });

  it('does not show images/ row when no image entries present', () => {
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 60,
      pipelineResult: makePipelineResult(),
      filesGenerated: ['transcript.md', 'combined.md'],
    });
    expect(result).not.toContain('images/');
  });

  it('does not list individual image files in the files table', () => {
    const imageFiles = ['images/frame-00-01-00.png', 'images/frame-00-02-00.png'];
    const result = writeGuide({
      title: 'Test',
      source: 's',
      duration: 60,
      pipelineResult: makePipelineResult(),
      filesGenerated: ['transcript.md', ...imageFiles],
    });
    expect(result).not.toContain('frame-00-01-00.png');
    expect(result).not.toContain('frame-00-02-00.png');
  });
});
