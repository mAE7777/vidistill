import { describe, it, expect } from 'vitest';
import { writeMetadata, writeRawOutput } from './metadata.js';
import type {
  PipelineResult,
  SegmentResult,
  VideoProfile,
  Pass1Result,
  Pass2Result,
  CodeReconstruction,
  PeopleExtraction,
  ChatExtraction,
  ImplicitSignals,
  SynthesisResult,
} from '../types/index.js';

function makePipelineResult(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
    segments: [],
    passesRun: [],
    errors: [],
    ...overrides,
  };
}

function makeSegment(index: number, overrides: Partial<SegmentResult> = {}): SegmentResult {
  return { index, pass1: null, pass2: null, ...overrides };
}

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
  recommendations: { resolution: 'medium', segmentMinutes: 10, passes: ['pass1', 'pass2'] },
};

const PASS1: Pass1Result = {
  segment_index: 0,
  time_range: '0:00-10:00',
  transcript_entries: [],
  speaker_summary: [],
};

const PASS2: Pass2Result = {
  segment_index: 0,
  time_range: '0:00-10:00',
  code_blocks: [],
  visual_notes: [],
  screen_timeline: [],
};

const CODE_RECONSTRUCTION: CodeReconstruction = {
  files: [],
  dependencies_mentioned: [],
  build_commands: [],
};

const PEOPLE: PeopleExtraction = {
  participants: [{ name: 'Alice', role: 'host', organization: 'Acme', speaking_segments: [], contact_info: [], contributions: [] }],
  relationships: [],
};

const CHAT: ChatExtraction = {
  messages: [{ timestamp: '00:01:00', sender: 'Bob', text: 'Hello' }],
  links: [],
};

const SIGNALS: ImplicitSignals = {
  emotional_shifts: [],
  questions_implicit: [],
  decisions_implicit: [],
  tasks_assigned: [],
  emphasis_patterns: [],
};

const SYNTHESIS: SynthesisResult = {
  overview: 'Summary of the video.',
  key_decisions: [],
  key_concepts: [],
  action_items: [],
  questions_raised: [],
  suggestions: [],
  topics: [],
  files_to_generate: [],
};

// ── writeMetadata ─────────────────────────────────────────────────────────────

describe('writeMetadata', () => {
  it('returns a valid JSON string', () => {
    const result = writeMetadata({
      title: 'My Video',
      source: 'example/test.mp4',
      duration: 600,
      model: 'gemini-2.0-flash',
      processingTimeMs: 12000,
      filesGenerated: ['guide.md'],
      pipelineResult: makePipelineResult(),
    });
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('contains videoTitle', () => {
    const result = writeMetadata({
      title: 'My Video',
      source: 's',
      duration: 0,
      model: 'm',
      processingTimeMs: 0,
      filesGenerated: [],
      pipelineResult: makePipelineResult(),
    });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed['videoTitle']).toBe('My Video');
  });

  it('contains source', () => {
    const result = writeMetadata({
      title: 't',
      source: 'example/test.mp4',
      duration: 0,
      model: 'm',
      processingTimeMs: 0,
      filesGenerated: [],
      pipelineResult: makePipelineResult(),
    });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed['source']).toBe('example/test.mp4');
  });

  it('contains duration', () => {
    const result = writeMetadata({
      title: 't',
      source: 's',
      duration: 330,
      model: 'm',
      processingTimeMs: 0,
      filesGenerated: [],
      pipelineResult: makePipelineResult(),
    });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed['duration']).toBe(330);
  });

  it('contains type from videoProfile', () => {
    const result = writeMetadata({
      title: 't',
      source: 's',
      duration: 0,
      model: 'm',
      processingTimeMs: 0,
      filesGenerated: [],
      pipelineResult: makePipelineResult({ videoProfile: PROFILE }),
    });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed['type']).toBe('coding');
  });

  it('uses "unknown" type when no videoProfile', () => {
    const result = writeMetadata({
      title: 't',
      source: 's',
      duration: 0,
      model: 'm',
      processingTimeMs: 0,
      filesGenerated: [],
      pipelineResult: makePipelineResult(),
    });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed['type']).toBe('unknown');
  });

  it('contains model', () => {
    const result = writeMetadata({
      title: 't',
      source: 's',
      duration: 0,
      model: 'gemini-2.0-flash',
      processingTimeMs: 0,
      filesGenerated: [],
      pipelineResult: makePipelineResult(),
    });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed['model']).toBe('gemini-2.0-flash');
  });

  it('contains passesRun', () => {
    const result = writeMetadata({
      title: 't',
      source: 's',
      duration: 0,
      model: 'm',
      processingTimeMs: 0,
      filesGenerated: [],
      pipelineResult: makePipelineResult({ passesRun: ['pass1', 'pass2'] }),
    });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed['passesRun']).toEqual(['pass1', 'pass2']);
  });

  it('contains segmentCount matching segments array length', () => {
    const segments = [makeSegment(0), makeSegment(1), makeSegment(2)];
    const result = writeMetadata({
      title: 't',
      source: 's',
      duration: 0,
      model: 'm',
      processingTimeMs: 0,
      filesGenerated: [],
      pipelineResult: makePipelineResult({ segments }),
    });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed['segmentCount']).toBe(3);
  });

  it('contains processingTimeMs', () => {
    const result = writeMetadata({
      title: 't',
      source: 's',
      duration: 0,
      model: 'm',
      processingTimeMs: 42000,
      filesGenerated: [],
      pipelineResult: makePipelineResult(),
    });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed['processingTimeMs']).toBe(42000);
  });

  it('contains filesGenerated', () => {
    const result = writeMetadata({
      title: 't',
      source: 's',
      duration: 0,
      model: 'm',
      processingTimeMs: 0,
      filesGenerated: ['guide.md', 'transcript.md'],
      pipelineResult: makePipelineResult(),
    });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed['filesGenerated']).toEqual(['guide.md', 'transcript.md']);
  });

  it('contains errors array', () => {
    const result = writeMetadata({
      title: 't',
      source: 's',
      duration: 0,
      model: 'm',
      processingTimeMs: 0,
      filesGenerated: [],
      pipelineResult: makePipelineResult({ errors: ['segment 0 failed'] }),
    });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed['errors']).toEqual(['segment 0 failed']);
  });

  it('contains generatedAt as ISO 8601 string', () => {
    const result = writeMetadata({
      title: 't',
      source: 's',
      duration: 0,
      model: 'm',
      processingTimeMs: 0,
      filesGenerated: [],
      pipelineResult: makePipelineResult(),
    });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(typeof parsed['generatedAt']).toBe('string');
    expect(() => new Date(parsed['generatedAt'] as string)).not.toThrow();
    expect(new Date(parsed['generatedAt'] as string).toISOString()).toBe(parsed['generatedAt']);
  });

  it('is pretty-printed with 2-space indentation', () => {
    const result = writeMetadata({
      title: 't',
      source: 's',
      duration: 0,
      model: 'm',
      processingTimeMs: 0,
      filesGenerated: [],
      pipelineResult: makePipelineResult(),
    });
    expect(result).toContain('\n  ');
  });
});

// ── writeRawOutput ────────────────────────────────────────────────────────────

describe('writeRawOutput', () => {
  it('returns empty map when pipeline has no data', () => {
    const result = writeRawOutput(makePipelineResult());
    expect(result.size).toBe(0);
  });

  it('includes pass0-scene.json when videoProfile is present', () => {
    const result = writeRawOutput(makePipelineResult({ videoProfile: PROFILE }));
    expect(result.has('pass0-scene.json')).toBe(true);
  });

  it('does not include pass0-scene.json when videoProfile is absent', () => {
    const result = writeRawOutput(makePipelineResult());
    expect(result.has('pass0-scene.json')).toBe(false);
  });

  it('pass0-scene.json content is valid JSON matching videoProfile', () => {
    const result = writeRawOutput(makePipelineResult({ videoProfile: PROFILE }));
    const content = result.get('pass0-scene.json');
    expect(content).toBeDefined();
    expect(JSON.parse(content!)).toEqual(PROFILE);
  });

  it('includes pass1-segN.json for each segment with pass1 result', () => {
    const seg0 = makeSegment(0, { pass1: PASS1 });
    const seg1 = makeSegment(1, { pass1: { ...PASS1, segment_index: 1 } });
    const result = writeRawOutput(makePipelineResult({ segments: [seg0, seg1] }));
    expect(result.has('pass1-seg0.json')).toBe(true);
    expect(result.has('pass1-seg1.json')).toBe(true);
  });

  it('does not include pass1-segN.json when pass1 is null', () => {
    const seg = makeSegment(0, { pass1: null });
    const result = writeRawOutput(makePipelineResult({ segments: [seg] }));
    expect(result.has('pass1-seg0.json')).toBe(false);
  });

  it('includes pass2-segN.json for each segment with pass2 result', () => {
    const seg = makeSegment(0, { pass2: PASS2 });
    const result = writeRawOutput(makePipelineResult({ segments: [seg] }));
    expect(result.has('pass2-seg0.json')).toBe(true);
  });

  it('does not include pass2-segN.json when pass2 is null', () => {
    const seg = makeSegment(0, { pass2: null });
    const result = writeRawOutput(makePipelineResult({ segments: [seg] }));
    expect(result.has('pass2-seg0.json')).toBe(false);
  });

  it('includes pass3a-segN.json when code reconstruction is present', () => {
    const seg = makeSegment(0, { pass3a: CODE_RECONSTRUCTION });
    const result = writeRawOutput(makePipelineResult({ segments: [seg] }));
    expect(result.has('pass3a-seg0.json')).toBe(true);
  });

  it('does not include pass3a-segN.json when pass3a is absent or null', () => {
    const seg = makeSegment(0);
    const result = writeRawOutput(makePipelineResult({ segments: [seg] }));
    expect(result.has('pass3a-seg0.json')).toBe(false);
  });

  it('includes pass3b-people.json when peopleExtraction is present', () => {
    const result = writeRawOutput(makePipelineResult({ peopleExtraction: PEOPLE }));
    expect(result.has('pass3b-people.json')).toBe(true);
  });

  it('does not include pass3b-people.json when peopleExtraction is absent', () => {
    const result = writeRawOutput(makePipelineResult());
    expect(result.has('pass3b-people.json')).toBe(false);
  });

  it('does not include pass3b-people.json when peopleExtraction is null', () => {
    const result = writeRawOutput(makePipelineResult({ peopleExtraction: null }));
    expect(result.has('pass3b-people.json')).toBe(false);
  });

  it('includes pass3c-segN.json when chat extraction is present', () => {
    const seg = makeSegment(0, { pass3c: CHAT });
    const result = writeRawOutput(makePipelineResult({ segments: [seg] }));
    expect(result.has('pass3c-seg0.json')).toBe(true);
  });

  it('does not include pass3c-segN.json when pass3c is absent or null', () => {
    const seg = makeSegment(0);
    const result = writeRawOutput(makePipelineResult({ segments: [seg] }));
    expect(result.has('pass3c-seg0.json')).toBe(false);
  });

  it('includes pass3d-segN.json when implicit signals is present', () => {
    const seg = makeSegment(0, { pass3d: SIGNALS });
    const result = writeRawOutput(makePipelineResult({ segments: [seg] }));
    expect(result.has('pass3d-seg0.json')).toBe(true);
  });

  it('does not include pass3d-segN.json when pass3d is absent or null', () => {
    const seg = makeSegment(0);
    const result = writeRawOutput(makePipelineResult({ segments: [seg] }));
    expect(result.has('pass3d-seg0.json')).toBe(false);
  });

  it('includes synthesis.json when synthesisResult is present', () => {
    const result = writeRawOutput(makePipelineResult({ synthesisResult: SYNTHESIS }));
    expect(result.has('synthesis.json')).toBe(true);
  });

  it('does not include synthesis.json when synthesisResult is absent', () => {
    const result = writeRawOutput(makePipelineResult());
    expect(result.has('synthesis.json')).toBe(false);
  });

  it('synthesis.json content is valid JSON matching synthesisResult', () => {
    const result = writeRawOutput(makePipelineResult({ synthesisResult: SYNTHESIS }));
    const content = result.get('synthesis.json');
    expect(content).toBeDefined();
    expect(JSON.parse(content!)).toEqual(SYNTHESIS);
  });

  it('produces 11 files for 5 segments with pass1 and pass2 results plus videoProfile', () => {
    const segments = [0, 1, 2, 3, 4].map((i) =>
      makeSegment(i, {
        pass1: { ...PASS1, segment_index: i },
        pass2: { ...PASS2, segment_index: i },
      }),
    );
    const result = writeRawOutput(
      makePipelineResult({ segments, videoProfile: PROFILE }),
    );
    // pass0-scene.json + 5x pass1-segN.json + 5x pass2-segN.json = 11
    expect(result.size).toBe(11);
  });

  it('raw JSON files are pretty-printed with 2-space indentation', () => {
    const result = writeRawOutput(makePipelineResult({ videoProfile: PROFILE }));
    const content = result.get('pass0-scene.json');
    expect(content).toContain('\n  ');
  });

  it('uses segment index for filenames, not array position', () => {
    // segments with non-sequential indices
    const seg = makeSegment(3, { pass1: PASS1 });
    const result = writeRawOutput(makePipelineResult({ segments: [seg] }));
    expect(result.has('pass1-seg3.json')).toBe(true);
    expect(result.has('pass1-seg0.json')).toBe(false);
  });
});
