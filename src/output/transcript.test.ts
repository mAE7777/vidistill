import { describe, it, expect } from 'vitest';
import { writeTranscript } from './transcript.js';
import type { PipelineResult, Pass1Result, SegmentResult } from '../types/index.js';

function makeSegment(pass1: Pass1Result | null, index = 0): SegmentResult {
  return { index, pass1, pass2: null };
}

function makePipelineResult(segments: SegmentResult[]): PipelineResult {
  return { segments, passesRun: [], errors: [] };
}

const PASS1_BASIC: Pass1Result = {
  segment_index: 0,
  time_range: '00:00:00 - 00:10:00',
  transcript_entries: [
    { timestamp: '00:00:05', speaker: 'SPEAKER_00', text: 'Hello everyone', tone: 'neutral' },
    { timestamp: '00:00:15', speaker: 'SPEAKER_01', text: 'Welcome to the session', tone: 'friendly' },
  ],
  speaker_summary: [
    { speaker_id: 'SPEAKER_00', description: 'Instructor' },
    { speaker_id: 'SPEAKER_01', description: 'Host' },
  ],
};

describe('writeTranscript', () => {
  it('returns a string starting with # Transcript', () => {
    const result = writeTranscript({ pipelineResult: makePipelineResult([]) });
    expect(result).toContain('# Transcript');
  });

  it('shows placeholder when no segments have pass1', () => {
    const result = writeTranscript({
      pipelineResult: makePipelineResult([makeSegment(null)]),
    });
    expect(result).toContain('No transcript data available');
  });

  it('includes segment header with time range', () => {
    const result = writeTranscript({
      pipelineResult: makePipelineResult([makeSegment(PASS1_BASIC)]),
    });
    expect(result).toContain('00:00:00 - 00:10:00');
  });

  it('includes transcript text for each entry', () => {
    const result = writeTranscript({
      pipelineResult: makePipelineResult([makeSegment(PASS1_BASIC)]),
    });
    expect(result).toContain('Hello everyone');
    expect(result).toContain('Welcome to the session');
  });

  it('includes speaker labels in entries', () => {
    const result = writeTranscript({
      pipelineResult: makePipelineResult([makeSegment(PASS1_BASIC)]),
    });
    expect(result).toContain('SPEAKER_00');
    expect(result).toContain('SPEAKER_01');
  });

  it('includes timestamps in entries', () => {
    const result = writeTranscript({
      pipelineResult: makePipelineResult([makeSegment(PASS1_BASIC)]),
    });
    expect(result).toContain('00:00:05');
    expect(result).toContain('00:00:15');
  });

  it('bolds emphasis words in transcript text', () => {
    const pass1: Pass1Result = {
      segment_index: 0,
      time_range: '00:00:00 - 00:05:00',
      transcript_entries: [
        {
          timestamp: '00:00:10',
          speaker: 'SPEAKER_00',
          text: 'The important concept is recursion',
          tone: 'instructional',
          emphasis_words: ['important', 'recursion'],
        },
      ],
      speaker_summary: [],
    };
    const result = writeTranscript({ pipelineResult: makePipelineResult([makeSegment(pass1)]) });
    expect(result).toContain('**important**');
    expect(result).toContain('**recursion**');
  });

  it('does not double-bold already-bolded words', () => {
    const pass1: Pass1Result = {
      segment_index: 0,
      time_range: '00:00:00 - 00:05:00',
      transcript_entries: [
        {
          timestamp: '00:00:10',
          speaker: 'SPEAKER_00',
          text: 'Use async await for async operations',
          tone: 'instructional',
          emphasis_words: ['async'],
        },
      ],
      speaker_summary: [],
    };
    const result = writeTranscript({ pipelineResult: makePipelineResult([makeSegment(pass1)]) });
    // Should not produce ****async**** (double-bolded)
    expect(result).not.toContain('****');
  });

  it('shows pause marker for pauses >= 1.5s', () => {
    const pass1: Pass1Result = {
      segment_index: 0,
      time_range: '00:00:00 - 00:05:00',
      transcript_entries: [
        {
          timestamp: '00:00:10',
          speaker: 'SPEAKER_00',
          text: 'Think about this',
          tone: 'reflective',
          pause_after_seconds: 2.5,
        },
      ],
      speaker_summary: [],
    };
    const result = writeTranscript({ pipelineResult: makePipelineResult([makeSegment(pass1)]) });
    expect(result).toContain('pause');
    expect(result).toContain('2.5');
  });

  it('does not show pause marker for pauses < 1.5s', () => {
    const pass1: Pass1Result = {
      segment_index: 0,
      time_range: '00:00:00 - 00:05:00',
      transcript_entries: [
        {
          timestamp: '00:00:10',
          speaker: 'SPEAKER_00',
          text: 'Quick thought',
          tone: 'neutral',
          pause_after_seconds: 0.5,
        },
      ],
      speaker_summary: [],
    };
    const result = writeTranscript({ pipelineResult: makePipelineResult([makeSegment(pass1)]) });
    expect(result).not.toContain('pause');
  });

  it('handles multiple segments', () => {
    const pass1b: Pass1Result = {
      segment_index: 1,
      time_range: '00:10:00 - 00:20:00',
      transcript_entries: [
        { timestamp: '00:10:30', speaker: 'SPEAKER_00', text: 'Moving on to part two', tone: 'neutral' },
      ],
      speaker_summary: [],
    };
    const result = writeTranscript({
      pipelineResult: makePipelineResult([makeSegment(PASS1_BASIC, 0), makeSegment(pass1b, 1)]),
    });
    expect(result).toContain('Segment 1');
    expect(result).toContain('Segment 2');
    expect(result).toContain('Moving on to part two');
  });

  it('skips segments with null pass1', () => {
    const pass1b: Pass1Result = {
      segment_index: 2,
      time_range: '00:20:00 - 00:30:00',
      transcript_entries: [
        { timestamp: '00:20:05', speaker: 'SPEAKER_00', text: 'Third segment content', tone: 'neutral' },
      ],
      speaker_summary: [],
    };
    const result = writeTranscript({
      pipelineResult: makePipelineResult([
        makeSegment(PASS1_BASIC, 0),
        makeSegment(null, 1),
        makeSegment(pass1b, 2),
      ]),
    });
    expect(result).toContain('Third segment content');
    expect(result).toContain('Hello everyone');
    // Segment 2 with null pass1 should not appear as a segment header with "null"
    expect(result).not.toContain('null');
  });

  it('includes speaker summary in segment', () => {
    const result = writeTranscript({
      pipelineResult: makePipelineResult([makeSegment(PASS1_BASIC)]),
    });
    expect(result).toContain('Instructor');
    expect(result).toContain('Host');
  });

  it('shows placeholder for empty transcript entries', () => {
    const pass1: Pass1Result = {
      segment_index: 0,
      time_range: '00:00:00 - 00:05:00',
      transcript_entries: [],
      speaker_summary: [],
    };
    const result = writeTranscript({ pipelineResult: makePipelineResult([makeSegment(pass1)]) });
    expect(result).toContain('No transcript entries for this segment');
  });
});
