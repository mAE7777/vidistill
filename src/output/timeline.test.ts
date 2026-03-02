import { describe, it, expect } from 'vitest';
import { generateTimeline } from './timeline.js';
import type { GenerateTimelineParams } from './timeline.js';
import type { PipelineResult } from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalPipeline(): PipelineResult {
  return {
    segments: [{ index: 0, pass1: null, pass2: null }],
    passesRun: [],
    errors: [],
  };
}

function makeFullPipeline(): PipelineResult {
  return {
    segments: [
      {
        index: 0,
        pass1: {
          segment_index: 0,
          time_range: '00:00-01:00',
          transcript_entries: [
            { timestamp: '00:00:05', speaker: 'Alice', text: 'Hello and welcome to the course.', tone: 'neutral' },
            { timestamp: '00:00:45', speaker: 'Alice', text: 'Today we cover TypeScript generics.', tone: 'neutral' },
            { timestamp: '00:01:20', speaker: 'Bob', text: 'Any questions so far?', tone: 'question' },
          ],
          speaker_summary: [],
        },
        pass2: {
          segment_index: 0,
          time_range: '00:00-01:00',
          code_blocks: [
            {
              timestamp: '00:00:30',
              filename: 'app.ts',
              language: 'typescript',
              content: 'const x = 1;',
              screen_type: 'editor',
              change_type: 'new_file',
              instructor_explanation: 'Creating the entry point.',
            },
            {
              timestamp: '00:01:10',
              filename: 'utils.ts',
              language: 'typescript',
              content: 'export function id<T>(v: T): T { return v; }',
              screen_type: 'editor',
              change_type: 'new_file',
              instructor_explanation: 'Generic identity function.',
            },
          ],
          visual_notes: [
            { timestamp: '00:00:15', visual_type: 'slide', description: 'Title slide: TypeScript Generics' },
            { timestamp: '00:01:00', visual_type: 'diagram', description: 'Type parameter flow diagram' },
          ],
          screen_timeline: [],
        },
      },
    ],
    passesRun: ['pass1', 'pass2', 'synthesis'],
    errors: [],
    synthesisResult: {
      overview: 'An intro to TypeScript generics.',
      key_decisions: [],
      key_concepts: [],
      action_items: [],
      questions_raised: [],
      suggestions: [],
      topics: [
        { title: 'Generics intro', timestamps: ['00:00:00'], summary: 'Introduction to generics.', key_points: [] },
        { title: 'Q&A', timestamps: ['00:01:20'], summary: 'Questions from audience.', key_points: [] },
      ],
      files_to_generate: [],
      prerequisites: [],
    },
  };
}

function makeParams(overrides: Partial<GenerateTimelineParams> = {}): GenerateTimelineParams {
  return {
    pipelineResult: makeFullPipeline(),
    duration: 120,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateTimeline', () => {
  it('returns a string', () => {
    const result = generateTimeline(makeParams());
    expect(typeof result).toBe('string');
  });

  it('starts with <!DOCTYPE html>', () => {
    const result = generateTimeline(makeParams());
    expect(result.trimStart()).toMatch(/^<!DOCTYPE html>/i);
  });

  it('contains a viewport meta tag', () => {
    const result = generateTimeline(makeParams());
    expect(result).toContain('name="viewport"');
  });

  it('has no external CSS link dependencies', () => {
    const result = generateTimeline(makeParams());
    // No <link rel="stylesheet" href= pointing to an external resource
    expect(result).not.toMatch(/<link[^>]+href=["'][^"'#][^"']*["']/);
  });

  it('has no external script src dependencies', () => {
    const result = generateTimeline(makeParams());
    expect(result).not.toMatch(/<script[^>]+src=/);
  });

  it('includes prefers-color-scheme: dark in inline CSS', () => {
    const result = generateTimeline(makeParams());
    expect(result).toContain('prefers-color-scheme: dark');
  });

  it('includes the speech lane', () => {
    const result = generateTimeline(makeParams());
    expect(result).toContain('marker-speech');
  });

  it('includes the code lane', () => {
    const result = generateTimeline(makeParams());
    expect(result).toContain('marker-code');
  });

  it('includes the visual lane', () => {
    const result = generateTimeline(makeParams());
    expect(result).toContain('marker-visual');
  });

  it('includes topic markers from synthesis', () => {
    const result = generateTimeline(makeParams());
    expect(result).toContain('marker-topic');
  });

  it('positions markers with a left: percentage style', () => {
    const result = generateTimeline(makeParams());
    expect(result).toMatch(/style="left:\d+(\.\d+)?%"/);
  });

  it('shows topic title in marker tooltip', () => {
    const result = generateTimeline(makeParams());
    expect(result).toContain('Generics intro');
  });

  it('shows code filename in marker tooltip', () => {
    const result = generateTimeline(makeParams());
    expect(result).toContain('app.ts');
  });

  it('shows visual type in marker tooltip', () => {
    const result = generateTimeline(makeParams());
    expect(result).toContain('slide');
  });

  it('shows speaker name in speech marker tooltip', () => {
    const result = generateTimeline(makeParams());
    expect(result).toContain('Alice');
  });

  it('handles minimal pipeline with no pass data gracefully', () => {
    const params = makeParams({ pipelineResult: makeMinimalPipeline() });
    const result = generateTimeline(params);
    expect(result.trimStart()).toMatch(/^<!DOCTYPE html>/i);
    // No markers rendered but HTML is still valid structure
    expect(result).toContain('marker-speech');
    expect(result).toContain('marker-code');
  });

  it('handles zero duration without throwing', () => {
    expect(() => generateTimeline(makeParams({ duration: 0 }))).not.toThrow();
  });

  it('handles empty synthesis topics gracefully', () => {
    const pipeline = makeFullPipeline();
    pipeline.synthesisResult!.topics = [];
    const result = generateTimeline(makeParams({ pipelineResult: pipeline }));
    expect(result.trimStart()).toMatch(/^<!DOCTYPE html>/i);
  });

  it('groups speech entries within 30-second windows', () => {
    // Two entries within 30s of each other should produce only one marker per window
    const pipeline: PipelineResult = {
      segments: [
        {
          index: 0,
          pass1: {
            segment_index: 0,
            time_range: '00:00-00:30',
            transcript_entries: [
              { timestamp: '00:00:00', speaker: 'Alice', text: 'First sentence.', tone: 'neutral' },
              { timestamp: '00:00:10', speaker: 'Alice', text: 'Second sentence, same window.', tone: 'neutral' },
              { timestamp: '00:00:35', speaker: 'Alice', text: 'Third sentence, new window.', tone: 'neutral' },
            ],
            speaker_summary: [],
          },
          pass2: null,
        },
      ],
      passesRun: ['pass1'],
      errors: [],
    };
    const result = generateTimeline({ pipelineResult: pipeline, duration: 120 });
    // Count speech markers — expect 2 (one per window), not 3
    const speechMarkerCount = (result.match(/class="marker marker-speech"/g) ?? []).length;
    expect(speechMarkerCount).toBe(2);
  });

  it('renders a time axis with tick marks', () => {
    const result = generateTimeline(makeParams({ duration: 600 }));
    expect(result).toContain('class="tick"');
  });

  it('renders the legend with all four lane colours', () => {
    const result = generateTimeline(makeParams());
    expect(result).toContain('legend-dot speech');
    expect(result).toContain('legend-dot code');
    expect(result).toContain('legend-dot visual');
    expect(result).toContain('legend-dot topic');
  });

  it('renders vanilla JS tooltip logic without external dependencies', () => {
    const result = generateTimeline(makeParams());
    // Has inline script
    expect(result).toContain('<script>');
    // No src= attribute on script tags
    expect(result).not.toMatch(/<script[^>]+src=/);
  });

  it('escapes HTML special characters in marker labels', () => {
    const pipeline: PipelineResult = {
      segments: [
        {
          index: 0,
          pass1: null,
          pass2: {
            segment_index: 0,
            time_range: '00:00-01:00',
            code_blocks: [
              {
                timestamp: '00:00:10',
                filename: '<script>alert(1)</script>',
                language: 'js',
                content: '',
                screen_type: 'editor',
                change_type: 'new_file',
                instructor_explanation: '',
              },
            ],
            visual_notes: [],
            screen_timeline: [],
          },
        },
      ],
      passesRun: ['pass2'],
      errors: [],
    };
    const result = generateTimeline({ pipelineResult: pipeline, duration: 120 });
    expect(result).not.toContain('<script>alert(1)</script>');
    expect(result).toContain('&lt;script&gt;');
  });
});
