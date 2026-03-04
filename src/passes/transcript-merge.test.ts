import { describe, it, expect } from 'vitest';
import { mergeTranscriptResults } from './transcript-merge.js';
import type { Pass1aResult, Pass1bResult } from '../types/index.js';

function make1a(entries: Array<{ timestamp: string; text: string }>): Pass1aResult {
  return {
    segment_index: 0,
    time_range: '00:00:00 - 00:01:00',
    transcript_entries: entries.map((e) => ({ ...e, tone: 'neutral' as const })),
  };
}

function make1b(
  assignments: Array<{ timestamp: string; speaker: string }>,
  summary: Array<{ speaker_id: string; description: string }> = [],
): Pass1bResult {
  return { speaker_assignments: assignments, speaker_summary: summary };
}

describe('mergeTranscriptResults', () => {
  it('assigns speaker on exact timestamp match', () => {
    const result = mergeTranscriptResults(
      make1a([{ timestamp: '00:01:05', text: 'Hello' }]),
      make1b([{ timestamp: '00:01:05', speaker: 'SPEAKER_00' }]),
    );

    expect(result.transcript_entries[0].speaker).toBe('SPEAKER_00');
  });

  it('assigns speaker on near match within 3s window', () => {
    const result = mergeTranscriptResults(
      make1a([{ timestamp: '00:01:05', text: 'Hello' }]),
      make1b([{ timestamp: '00:01:06', speaker: 'SPEAKER_01' }]),
    );

    expect(result.transcript_entries[0].speaker).toBe('SPEAKER_01');
  });

  it('assigns SPEAKER_UNKNOWN when no match within 3s', () => {
    const result = mergeTranscriptResults(
      make1a([{ timestamp: '00:01:05', text: 'Hello' }]),
      make1b([{ timestamp: '00:01:10', speaker: 'SPEAKER_00' }]),
    );

    expect(result.transcript_entries[0].speaker).toBe('SPEAKER_UNKNOWN');
  });

  it('handles empty 1a and 1b', () => {
    const result = mergeTranscriptResults(
      make1a([]),
      make1b([]),
    );

    expect(result.transcript_entries).toEqual([]);
    expect(result.speaker_summary).toEqual([]);
  });

  it('handles multiple entries with various match quality', () => {
    const result = mergeTranscriptResults(
      make1a([
        { timestamp: '00:00:01', text: 'First' },
        { timestamp: '00:00:10', text: 'Second' },
        { timestamp: '00:00:20', text: 'Third' },
        { timestamp: '00:00:30', text: 'Fourth' },
      ]),
      make1b([
        { timestamp: '00:00:01', speaker: 'SPEAKER_00' },
        { timestamp: '00:00:11', speaker: 'SPEAKER_01' },
        // no match for 00:00:20 within 3s
        { timestamp: '00:00:30', speaker: 'SPEAKER_00' },
      ]),
    );

    expect(result.transcript_entries[0].speaker).toBe('SPEAKER_00');
    expect(result.transcript_entries[1].speaker).toBe('SPEAKER_01');
    expect(result.transcript_entries[2].speaker).toBe('SPEAKER_UNKNOWN');
    expect(result.transcript_entries[3].speaker).toBe('SPEAKER_00');
  });

  it('passes through speaker_summary from 1b', () => {
    const summary = [
      { speaker_id: 'SPEAKER_00', description: 'Main presenter' },
      { speaker_id: 'SPEAKER_01', description: 'Guest' },
    ];

    const result = mergeTranscriptResults(
      make1a([{ timestamp: '00:00:01', text: 'Hello' }]),
      make1b([{ timestamp: '00:00:01', speaker: 'SPEAKER_00' }], summary),
    );

    expect(result.speaker_summary).toEqual(summary);
  });

  it('preserves segment_index and time_range from 1a', () => {
    const pass1a: Pass1aResult = {
      segment_index: 3,
      time_range: '00:30:00 - 00:40:00',
      transcript_entries: [{ timestamp: '00:30:01', text: 'Test', tone: 'neutral' }],
    };

    const result = mergeTranscriptResults(
      pass1a,
      make1b([{ timestamp: '00:30:01', speaker: 'SPEAKER_00' }]),
    );

    expect(result.segment_index).toBe(3);
    expect(result.time_range).toBe('00:30:00 - 00:40:00');
  });

  it('produces valid Pass1Result shape with all required fields', () => {
    const result = mergeTranscriptResults(
      make1a([{ timestamp: '00:00:01', text: 'Hello' }]),
      make1b(
        [{ timestamp: '00:00:01', speaker: 'SPEAKER_00' }],
        [{ speaker_id: 'SPEAKER_00', description: 'Presenter' }],
      ),
    );

    expect(result).toHaveProperty('segment_index');
    expect(result).toHaveProperty('time_range');
    expect(result).toHaveProperty('transcript_entries');
    expect(result).toHaveProperty('speaker_summary');
    expect(result.transcript_entries[0]).toHaveProperty('timestamp');
    expect(result.transcript_entries[0]).toHaveProperty('speaker');
    expect(result.transcript_entries[0]).toHaveProperty('text');
    expect(result.transcript_entries[0]).toHaveProperty('tone');
  });

  it('handles timestamp format variations (H:MM:SS vs HH:MM:SS)', () => {
    const result = mergeTranscriptResults(
      make1a([{ timestamp: '0:01:05', text: 'Hello' }]),
      make1b([{ timestamp: '00:01:05', speaker: 'SPEAKER_00' }]),
    );

    expect(result.transcript_entries[0].speaker).toBe('SPEAKER_00');
  });

  it('does not reuse an assignment for multiple entries', () => {
    const result = mergeTranscriptResults(
      make1a([
        { timestamp: '00:00:01', text: 'First' },
        { timestamp: '00:00:02', text: 'Second' },
      ]),
      make1b([
        { timestamp: '00:00:01', speaker: 'SPEAKER_00' },
      ]),
    );

    expect(result.transcript_entries[0].speaker).toBe('SPEAKER_00');
    expect(result.transcript_entries[1].speaker).toBe('SPEAKER_UNKNOWN');
  });
});
