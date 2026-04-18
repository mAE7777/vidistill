import { describe, it, expect } from 'vitest';
import { writeCombined } from './combined.js';
import type { PipelineResult, SegmentResult, Pass1Result, Pass2Result, SynthesisResult } from '../types/index.js';

function makePipelineResult(segments: SegmentResult[]): PipelineResult {
  return { segments, passesRun: [], errors: [] };
}

function makeSegment(
  index: number,
  pass1: Pass1Result | null = null,
  pass2: Pass2Result | null = null,
): SegmentResult {
  return { index, pass1, pass2 };
}

const PASS1: Pass1Result = {
  segment_index: 0,
  time_range: '00:00:00 - 00:10:00',
  transcript_entries: [
    { timestamp: '00:00:05', speaker: 'SPEAKER_00', text: 'Let me show you something', tone: 'instructional' },
    { timestamp: '00:00:30', speaker: 'SPEAKER_00', text: 'Here we go', tone: 'neutral' },
  ],
  speaker_summary: [],
};

const PASS2: Pass2Result = {
  segment_index: 0,
  time_range: '00:00:00 - 00:10:00',
  code_blocks: [
    {
      timestamp: '00:00:15',
      filename: 'app.ts',
      language: 'typescript',
      content: 'const x = 1;',
      screen_type: 'code_editor',
      change_type: 'new_file',
      instructor_explanation: 'Creating app.ts',
    },
  ],
  visual_notes: [
    { timestamp: '00:00:45', visual_type: 'diagram', description: 'Architecture overview' },
  ],
  screen_timeline: [],
};

describe('writeCombined', () => {
  it('returns a string starting with # Combined View', () => {
    const result = writeCombined({ pipelineResult: makePipelineResult([]) });
    expect(result).toContain('# Combined View');
  });

  it('shows segment header with time range', () => {
    const result = writeCombined({
      pipelineResult: makePipelineResult([makeSegment(0, PASS1, PASS2)]),
    });
    expect(result).toContain('00:00:00 - 00:10:00');
  });

  it('shows placeholder for segment with no data', () => {
    const result = writeCombined({
      pipelineResult: makePipelineResult([makeSegment(0)]),
    });
    expect(result).toContain('No data available for this segment');
  });

  it('includes speech entries', () => {
    const result = writeCombined({
      pipelineResult: makePipelineResult([makeSegment(0, PASS1, null)]),
    });
    expect(result).toContain('Let me show you something');
    expect(result).toContain('Here we go');
  });

  it('includes code blocks with language fence', () => {
    const result = writeCombined({
      pipelineResult: makePipelineResult([makeSegment(0, null, PASS2)]),
    });
    expect(result).toContain('```typescript');
    expect(result).toContain('const x = 1;');
    expect(result).toContain('app.ts');
  });

  it('includes visual notes', () => {
    const result = writeCombined({
      pipelineResult: makePipelineResult([makeSegment(0, null, PASS2)]),
    });
    expect(result).toContain('Architecture overview');
    expect(result).toContain('diagram');
  });

  it('interleaves events chronologically', () => {
    const result = writeCombined({
      pipelineResult: makePipelineResult([makeSegment(0, PASS1, PASS2)]),
    });
    // Events: speech@00:00:05, code@00:00:15, speech@00:00:30, visual@00:00:45
    const pos05 = result.indexOf('00:00:05');
    const pos15 = result.indexOf('00:00:15');
    const pos30 = result.indexOf('00:00:30');
    const pos45 = result.indexOf('00:00:45');
    expect(pos05).toBeGreaterThan(-1);
    expect(pos15).toBeGreaterThan(-1);
    expect(pos30).toBeGreaterThan(-1);
    expect(pos45).toBeGreaterThan(-1);
    expect(pos05).toBeLessThan(pos15);
    expect(pos15).toBeLessThan(pos30);
    expect(pos30).toBeLessThan(pos45);
  });

  it('speech comes before code at same timestamp', () => {
    const pass1Same: Pass1Result = {
      ...PASS1,
      transcript_entries: [
        { timestamp: '00:00:15', speaker: 'SPEAKER_00', text: 'Now let me type this', tone: 'instructional' },
      ],
    };
    const result = writeCombined({
      pipelineResult: makePipelineResult([makeSegment(0, pass1Same, PASS2)]),
    });
    const speechPos = result.indexOf('Now let me type this');
    const codePos = result.indexOf('const x = 1;');
    expect(speechPos).toBeLessThan(codePos);
  });

  it('includes change type badge for code blocks', () => {
    const result = writeCombined({
      pipelineResult: makePipelineResult([makeSegment(0, null, PASS2)]),
    });
    expect(result).toContain('[NEW]');
  });

  it('includes instructor explanation as blockquote', () => {
    const result = writeCombined({
      pipelineResult: makePipelineResult([makeSegment(0, null, PASS2)]),
    });
    expect(result).toContain('Creating app.ts');
  });

  it('applies speakerMapping to speech entries', () => {
    const mapping = { SPEAKER_00: 'Alice' };
    const result = writeCombined({
      pipelineResult: makePipelineResult([makeSegment(0, PASS1, null)]),
      speakerMapping: mapping,
    });
    expect(result).toContain('Alice:');
    expect(result).not.toContain('SPEAKER_00:');
  });

  it('leaves unmapped speakers unchanged with speakerMapping', () => {
    const mapping = { SPEAKER_01: 'Bob' };
    const result = writeCombined({
      pipelineResult: makePipelineResult([makeSegment(0, PASS1, null)]),
      speakerMapping: mapping,
    });
    expect(result).toContain('SPEAKER_00:');
  });

  it('works without speakerMapping (backward compatible)', () => {
    const result = writeCombined({
      pipelineResult: makePipelineResult([makeSegment(0, PASS1, null)]),
    });
    expect(result).toContain('SPEAKER_00:');
  });

  it('bolds emphasis words in speech', () => {
    const pass1WithEmphasis: Pass1Result = {
      ...PASS1,
      transcript_entries: [
        {
          timestamp: '00:00:05',
          speaker: 'SPEAKER_00',
          text: 'This is very important',
          tone: 'instructional',
          emphasis_words: ['important'],
        },
      ],
    };
    const result = writeCombined({
      pipelineResult: makePipelineResult([makeSegment(0, pass1WithEmphasis, null)]),
    });
    expect(result).toContain('**important**');
  });

  it('filters short emphasis words but keeps multi-word and long ones', () => {
    const pass1WithMixedEmphasis: Pass1Result = {
      ...PASS1,
      transcript_entries: [
        {
          timestamp: '00:00:05',
          speaker: 'SPEAKER_00',
          text: 'At the end of the world we see escalation dominance',
          tone: 'instructional',
          emphasis_words: ['end', 'world', 'escalation dominance'],
        },
      ],
    };
    const result = writeCombined({
      pipelineResult: makePipelineResult([makeSegment(0, pass1WithMixedEmphasis, null)]),
    });
    // "end" (3 chars) should NOT be bolded
    expect(result).not.toContain('**end**');
    // "world" (5 chars) SHOULD be bolded
    expect(result).toContain('**world**');
    // "escalation dominance" (multi-word) SHOULD be bolded
    expect(result).toContain('**escalation dominance**');
  });

  it('handles multiple segments', () => {
    const pass1b: Pass1Result = {
      segment_index: 1,
      time_range: '00:10:00 - 00:20:00',
      transcript_entries: [
        { timestamp: '00:10:05', speaker: 'SPEAKER_00', text: 'Second segment', tone: 'neutral' },
      ],
      speaker_summary: [],
    };
    const result = writeCombined({
      pipelineResult: makePipelineResult([makeSegment(0, PASS1, null), makeSegment(1, pass1b, null)]),
    });
    expect(result).toContain('Segment 1');
    expect(result).toContain('Segment 2');
    expect(result).toContain('Second segment');
  });

  describe('synthesisResult dedup', () => {
    const baseSynthesis: SynthesisResult = {
      overview: '',
      key_decisions: [],
      key_concepts: [],
      action_items: [],
      questions_raised: [],
      suggestions: [],
      topics: [],
      files_to_generate: [],
      prerequisites: [],
    };

    it('tokenOverlap ratio exceeds 0.6 for near-duplicate speech vs synthesis text', () => {
      // AC1: speech "React hooks let you use state in functional components"
      //      synthesis "React hooks enable state usage in functional components"
      // Shared tokens: React, hooks, state, in, functional, components = 6
      // speechTokenCount = 9; overlap/max = 6/9 > 0.6
      const speechText = 'React hooks let you use state in functional components';
      const synthText = 'React hooks enable state usage in functional components';
      const synthesis: SynthesisResult = {
        ...baseSynthesis,
        overview: synthText,
      };
      const pass1: Pass1Result = {
        segment_index: 0,
        time_range: '00:00:00 - 00:10:00',
        transcript_entries: [
          { timestamp: '00:00:05', speaker: 'SPEAKER_00', text: speechText, tone: 'instructional' },
        ],
        speaker_summary: [],
      };
      const result = writeCombined({
        pipelineResult: makePipelineResult([makeSegment(0, pass1, null)]),
        synthesisResult: synthesis,
      });
      // High-overlap speech entry should be filtered out
      expect(result).not.toContain(speechText);
    });

    it('speech entry with <60% overlap passes through unchanged', () => {
      // AC2: low overlap — different content
      const speechText = 'Now let me show the debugging workflow step by step';
      const synthesis: SynthesisResult = {
        ...baseSynthesis,
        overview: 'React hooks enable state usage in functional components',
      };
      const pass1: Pass1Result = {
        segment_index: 0,
        time_range: '00:00:00 - 00:10:00',
        transcript_entries: [
          { timestamp: '00:00:05', speaker: 'SPEAKER_00', text: speechText, tone: 'instructional' },
        ],
        speaker_summary: [],
      };
      const result = writeCombined({
        pipelineResult: makePipelineResult([makeSegment(0, pass1, null)]),
        synthesisResult: synthesis,
      });
      expect(result).toContain(speechText);
    });

    it('behaves identically to current behavior when synthesisResult is undefined', () => {
      // AC3: no synthesisResult — speech should appear
      const pass1: Pass1Result = {
        segment_index: 0,
        time_range: '00:00:00 - 00:10:00',
        transcript_entries: [
          { timestamp: '00:00:05', speaker: 'SPEAKER_00', text: 'React hooks let you use state in functional components', tone: 'instructional' },
        ],
        speaker_summary: [],
      };
      const resultNoSynth = writeCombined({
        pipelineResult: makePipelineResult([makeSegment(0, pass1, null)]),
      });
      expect(resultNoSynth).toContain('React hooks let you use state in functional components');
    });

    it('checks all synthesis text fields: key_decisions, key_concepts, action_items, topics', () => {
      const speechText = 'deploy to production on Friday using the rollout script';
      const synthesis: SynthesisResult = {
        ...baseSynthesis,
        key_decisions: [{ decision: 'deploy to production on Friday using the rollout script', timestamp: '00:01:00', context: '' }],
      };
      const pass1: Pass1Result = {
        segment_index: 0,
        time_range: '00:00:00 - 00:10:00',
        transcript_entries: [
          { timestamp: '00:00:05', speaker: 'SPEAKER_00', text: speechText, tone: 'instructional' },
        ],
        speaker_summary: [],
      };
      const result = writeCombined({
        pipelineResult: makePipelineResult([makeSegment(0, pass1, null)]),
        synthesisResult: synthesis,
      });
      // Exact match — high overlap — should be filtered
      expect(result).not.toContain(speechText);
    });

    it('checks topic key_points for overlap', () => {
      const speechText = 'use memoization to avoid expensive recalculations';
      const synthesis: SynthesisResult = {
        ...baseSynthesis,
        topics: [{
          title: 'Performance',
          timestamps: [],
          summary: '',
          key_points: ['use memoization to avoid expensive recalculations'],
        }],
      };
      const pass1: Pass1Result = {
        segment_index: 0,
        time_range: '00:00:00 - 00:10:00',
        transcript_entries: [
          { timestamp: '00:00:05', speaker: 'SPEAKER_00', text: speechText, tone: 'instructional' },
        ],
        speaker_summary: [],
      };
      const result = writeCombined({
        pipelineResult: makePipelineResult([makeSegment(0, pass1, null)]),
        synthesisResult: synthesis,
      });
      expect(result).not.toContain(speechText);
    });

    it('non-speech events (code, visual) are never filtered by synthesis overlap', () => {
      const synthesis: SynthesisResult = {
        ...baseSynthesis,
        overview: 'app typescript const x',
      };
      const result = writeCombined({
        pipelineResult: makePipelineResult([makeSegment(0, null, PASS2)]),
        synthesisResult: synthesis,
      });
      // Code block and visual note should still appear regardless of synthesis content
      expect(result).toContain('const x = 1;');
      expect(result).toContain('Architecture overview');
    });
  });
});
