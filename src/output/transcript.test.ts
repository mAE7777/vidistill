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

  it('does not include speaker summary descriptions', () => {
    const result = writeTranscript({
      pipelineResult: makePipelineResult([makeSegment(PASS1_BASIC)]),
    });
    expect(result).not.toContain('Instructor');
    expect(result).not.toContain('Host');
  });

  it('does not include pause markers', () => {
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
    expect(result).not.toContain('pause');
  });

  it('does not bold emphasis words in text', () => {
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
    expect(result).toContain('The important concept is recursion');
    expect(result).not.toContain('**important**');
    expect(result).not.toContain('**recursion**');
  });

  it('filters out entries beyond the segment time range', () => {
    const pass1: Pass1Result = {
      segment_index: 0,
      time_range: '00:00:00 - 00:10:00',
      transcript_entries: [
        { timestamp: '00:00:05', speaker: 'SPEAKER_00', text: 'Valid entry', tone: 'neutral' },
        { timestamp: '00:09:50', speaker: 'SPEAKER_00', text: 'Near the end', tone: 'neutral' },
        { timestamp: '00:15:00', speaker: 'SPEAKER_00', text: 'Hallucinated entry', tone: 'neutral' },
      ],
      speaker_summary: [],
    };
    const result = writeTranscript({ pipelineResult: makePipelineResult([makeSegment(pass1)]) });
    expect(result).toContain('Valid entry');
    expect(result).toContain('Near the end');
    expect(result).not.toContain('Hallucinated entry');
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
    expect(result).not.toContain('null');
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

  it('replaces speaker labels with mapped names in entries', () => {
    const result = writeTranscript({
      pipelineResult: makePipelineResult([makeSegment(PASS1_BASIC)]),
      speakerMapping: { SPEAKER_00: 'Alice', SPEAKER_01: 'Bob' },
    });
    expect(result).toContain('Alice');
    expect(result).toContain('Bob');
    expect(result).not.toContain('SPEAKER_00');
    expect(result).not.toContain('SPEAKER_01');
  });

  it('leaves speaker labels unchanged when no mapping provided', () => {
    const result = writeTranscript({
      pipelineResult: makePipelineResult([makeSegment(PASS1_BASIC)]),
    });
    expect(result).toContain('SPEAKER_00');
    expect(result).toContain('SPEAKER_01');
  });
});
