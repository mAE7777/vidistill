import { describe, it, expect } from 'vitest';
import {
  offsetTimestamp,
  offsetSegmentResult,
  deduplicateOverlaps,
} from './clip-pipeline.js';
import type { SegmentResult } from '../types/index.js';
import type { ResultOverlapInfo } from './clip-pipeline.js';

describe('offsetTimestamp', () => {
  it('adds offset to MM:SS format', () => {
    expect(offsetTimestamp('05:30', 1200)).toBe('00:25:30');
  });

  it('adds offset to HH:MM:SS format', () => {
    expect(offsetTimestamp('00:05:30', 3600)).toBe('01:05:30');
  });

  it('returns original for zero offset', () => {
    expect(offsetTimestamp('12:34', 0)).toBe('12:34');
  });

  it('does not go below zero', () => {
    expect(offsetTimestamp('00:10', -300)).toBe('00:00:00');
  });

  it('handles large offsets correctly', () => {
    // 5:30 + 2h40m = 2:45:30
    expect(offsetTimestamp('05:30', 9600)).toBe('02:45:30');
  });
});

describe('offsetSegmentResult', () => {
  const makeSegResult = (overrides?: Partial<SegmentResult>): SegmentResult => ({
    index: 0,
    pass1: {
      segment_index: 0,
      time_range: '00:00:00-00:10:00',
      transcript_entries: [
        { timestamp: '00:30', speaker: 'SPEAKER_00', text: 'Hello', tone: 'neutral' },
        { timestamp: '05:00', speaker: 'SPEAKER_01', text: 'Hi', tone: 'friendly' },
      ],
      speaker_summary: [{ speaker_id: 'SPEAKER_00', description: 'Main speaker' }],
    },
    pass2: {
      segment_index: 0,
      time_range: '00:00:00-00:10:00',
      code_blocks: [
        { timestamp: '02:00', timestamp_end: '03:00', filename: 'app.ts', language: 'typescript', content: 'const x = 1;', screen_type: 'editor', change_type: 'new_file', instructor_explanation: '' },
      ],
      visual_notes: [
        { timestamp: '01:00', visual_type: 'slide', description: 'Title slide' },
      ],
      screen_timeline: [
        { timestamp: '00:00', screen_state: 'editor' },
      ],
    },
    pass3c: {
      messages: [{ timestamp: '04:00', sender: 'User', text: 'Test message' }],
      links: [{ url: 'https://example.com', context: 'shared', timestamp: '06:00' }],
    },
    pass3d: {
      emotional_shifts: [{ timestamp: '08:00', from_state: 'calm', to_state: 'excited', trigger: 'demo' }],
      questions_implicit: [],
      decisions_implicit: [],
      tasks_assigned: [{ timestamp: '09:00', assignee: 'Alice', task: 'Review PR', deadline: 'EOD' }],
      emphasis_patterns: [{ concept: 'testing', times_mentioned: 2, timestamps: ['03:00', '07:00'], significance: 'important' }],
    },
    ...overrides,
  });

  it('offsets all timestamps by clip start time', () => {
    const result = makeSegResult();
    const offset = 20 * 60; // 20 minutes

    const shifted = offsetSegmentResult(result, offset, 5);

    // Index updated
    expect(shifted.index).toBe(5);

    // Pass 1
    expect(shifted.pass1!.segment_index).toBe(5);
    expect(shifted.pass1!.time_range).toBe('00:20:00-00:30:00');
    expect(shifted.pass1!.transcript_entries[0].timestamp).toBe('00:20:30');
    expect(shifted.pass1!.transcript_entries[1].timestamp).toBe('00:25:00');

    // Pass 2
    expect(shifted.pass2!.segment_index).toBe(5);
    expect(shifted.pass2!.code_blocks[0].timestamp).toBe('00:22:00');
    expect(shifted.pass2!.code_blocks[0].timestamp_end).toBe('00:23:00');
    expect(shifted.pass2!.visual_notes[0].timestamp).toBe('00:21:00');
    expect(shifted.pass2!.screen_timeline[0].timestamp).toBe('00:20:00');

    // Pass 3c
    expect(shifted.pass3c!.messages[0].timestamp).toBe('00:24:00');
    expect(shifted.pass3c!.links[0].timestamp).toBe('00:26:00');

    // Pass 3d
    expect(shifted.pass3d!.emotional_shifts[0].timestamp).toBe('00:28:00');
    expect(shifted.pass3d!.tasks_assigned[0].timestamp).toBe('00:29:00');
    expect(shifted.pass3d!.emphasis_patterns[0].timestamps).toEqual(['00:23:00', '00:27:00']);
  });

  it('does not mutate the original', () => {
    const result = makeSegResult();
    const original = result.pass1!.transcript_entries[0].timestamp;
    offsetSegmentResult(result, 600, 1);
    expect(result.pass1!.transcript_entries[0].timestamp).toBe(original);
  });

  it('handles null passes gracefully', () => {
    const result: SegmentResult = { index: 0, pass1: null, pass2: null };
    const shifted = offsetSegmentResult(result, 1200, 3);
    expect(shifted.index).toBe(3);
    expect(shifted.pass1).toBeNull();
    expect(shifted.pass2).toBeNull();
  });
});

describe('deduplicateOverlaps', () => {
  it('removes transcript entries from overlap zone of earlier clip', () => {

    const results: SegmentResult[] = [
      {
        index: 0,
        pass1: {
          segment_index: 0,
          time_range: '00:00:00-00:20:30',
          transcript_entries: [
            { timestamp: '00:10:00', speaker: 'A', text: 'Before overlap', tone: '' },
            { timestamp: '00:19:50', speaker: 'A', text: 'Right before', tone: '' },
            { timestamp: '00:20:05', speaker: 'A', text: 'In overlap — should be removed', tone: '' },
            { timestamp: '00:20:25', speaker: 'A', text: 'Also in overlap — removed', tone: '' },
          ],
          speaker_summary: [],
        },
        pass2: null,
      },
      {
        index: 1,
        pass1: {
          segment_index: 1,
          time_range: '00:20:00-00:40:30',
          transcript_entries: [
            { timestamp: '00:20:00', speaker: 'A', text: 'Clip 2 start of overlap', tone: '' },
            { timestamp: '00:20:30', speaker: 'A', text: 'After overlap', tone: '' },
            { timestamp: '00:39:55', speaker: 'A', text: 'Near end', tone: '' },
            { timestamp: '00:40:10', speaker: 'A', text: 'In overlap with clip 3 — removed', tone: '' },
          ],
          speaker_summary: [],
        },
        pass2: null,
      },
      {
        index: 2,
        pass1: {
          segment_index: 2,
          time_range: '00:40:00-01:00:00',
          transcript_entries: [
            { timestamp: '00:40:00', speaker: 'A', text: 'Clip 3 start', tone: '' },
          ],
          speaker_summary: [],
        },
        pass2: null,
      },
    ];

    const overlapInfos: ResultOverlapInfo[] = [
      { clipIndex: 0, isLastSegmentOfClip: true, nextClipStartTime: 1200 },
      { clipIndex: 1, isLastSegmentOfClip: true, nextClipStartTime: 2400 },
      { clipIndex: 2, isLastSegmentOfClip: true, nextClipStartTime: undefined },
    ];

    deduplicateOverlaps(results, overlapInfos);

    // Clip 0: entries at 20:05 and 20:25 removed (>= nextClipStartTime = 1200s = 20:00)
    expect(results[0].pass1!.transcript_entries).toHaveLength(2);
    expect(results[0].pass1!.transcript_entries[0].text).toBe('Before overlap');
    expect(results[0].pass1!.transcript_entries[1].text).toBe('Right before');

    // Clip 1: entry at 40:10 removed (>= clip[2].globalStartTime = 2400s = 40:00)
    expect(results[1].pass1!.transcript_entries).toHaveLength(3);
    expect(results[1].pass1!.transcript_entries[0].text).toBe('Clip 2 start of overlap');
    expect(results[1].pass1!.transcript_entries[1].text).toBe('After overlap');
    expect(results[1].pass1!.transcript_entries[2].text).toBe('Near end');

    // Clip 2 (last): unchanged
    expect(results[2].pass1!.transcript_entries).toHaveLength(1);
  });

  it('does nothing when no overlap', () => {
    const results: SegmentResult[] = [
      {
        index: 0,
        pass1: {
          segment_index: 0,
          time_range: '00:00:00-00:20:00',
          transcript_entries: [
            { timestamp: '00:19:55', speaker: 'A', text: 'Near end', tone: '' },
          ],
          speaker_summary: [],
        },
        pass2: null,
      },
      {
        index: 1,
        pass1: {
          segment_index: 1,
          time_range: '00:20:00-00:40:00',
          transcript_entries: [
            { timestamp: '00:20:00', speaker: 'A', text: 'Start', tone: '' },
          ],
          speaker_summary: [],
        },
        pass2: null,
      },
    ];

    const overlapInfos: ResultOverlapInfo[] = [
      { clipIndex: 0, isLastSegmentOfClip: true, nextClipStartTime: undefined },
      { clipIndex: 1, isLastSegmentOfClip: true, nextClipStartTime: undefined },
    ];

    deduplicateOverlaps(results, overlapInfos);

    expect(results[0].pass1!.transcript_entries).toHaveLength(1);
    expect(results[1].pass1!.transcript_entries).toHaveLength(1);
  });

  it('handles null passes without crashing', () => {
    const overlapInfos: ResultOverlapInfo[] = [
      { clipIndex: 0, isLastSegmentOfClip: true, nextClipStartTime: 1200 },
      { clipIndex: 1, isLastSegmentOfClip: true, nextClipStartTime: undefined },
    ];

    const results: SegmentResult[] = [
      { index: 0, pass1: null, pass2: null },
      { index: 1, pass1: null, pass2: null },
    ];

    expect(() => deduplicateOverlaps(results, overlapInfos)).not.toThrow();
  });

  it('only trims last segment of multi-segment clips', () => {
    // Clip 0 produces 2 segments; only the 2nd (last) should be trimmed
    const results: SegmentResult[] = [
      {
        index: 0,
        pass1: {
          segment_index: 0,
          time_range: '00:00:00-00:10:00',
          transcript_entries: [
            { timestamp: '00:09:00', speaker: 'A', text: 'Seg 0 end', tone: '' },
          ],
          speaker_summary: [],
        },
        pass2: null,
      },
      {
        index: 1,
        pass1: {
          segment_index: 1,
          time_range: '00:10:00-00:20:30',
          transcript_entries: [
            { timestamp: '00:15:00', speaker: 'A', text: 'Before overlap', tone: '' },
            { timestamp: '00:20:10', speaker: 'A', text: 'In overlap — trimmed', tone: '' },
          ],
          speaker_summary: [],
        },
        pass2: null,
      },
      {
        index: 2,
        pass1: {
          segment_index: 2,
          time_range: '00:20:00-00:40:00',
          transcript_entries: [
            { timestamp: '00:20:00', speaker: 'A', text: 'Clip 2 start', tone: '' },
          ],
          speaker_summary: [],
        },
        pass2: null,
      },
    ];

    const overlapInfos: ResultOverlapInfo[] = [
      { clipIndex: 0, isLastSegmentOfClip: false, nextClipStartTime: 1200 },  // not last seg — no trim
      { clipIndex: 0, isLastSegmentOfClip: true, nextClipStartTime: 1200 },   // last seg — trim at 20:00
      { clipIndex: 1, isLastSegmentOfClip: true, nextClipStartTime: undefined },
    ];

    deduplicateOverlaps(results, overlapInfos);

    // Segment 0 of clip 0: untouched (not last segment)
    expect(results[0].pass1!.transcript_entries).toHaveLength(1);
    // Segment 1 of clip 0 (last): entry at 20:10 trimmed
    expect(results[1].pass1!.transcript_entries).toHaveLength(1);
    expect(results[1].pass1!.transcript_entries[0].text).toBe('Before overlap');
    // Clip 1: untouched
    expect(results[2].pass1!.transcript_entries).toHaveLength(1);
  });
});

describe('estimateClipApiCalls', () => {
  // Import dynamically to avoid circular dependency issues in tests
  it('estimates more calls than single-segment pipeline', async () => {
    const { estimateApiCalls, estimateClipApiCalls } = await import('./estimator.js');
    const strategy = {
      passes: ['transcript', 'visual', 'code', 'people', 'chat', 'implicit', 'synthesis'],
      resolution: 'medium',
      segmentMinutes: 10,
    };

    const singleEstimate = estimateApiCalls(strategy, 1);
    const clipEstimate = estimateClipApiCalls(strategy, 6);

    // 6 clips should have significantly more total API calls than 1 segment
    expect(clipEstimate.totalCalls).toBeGreaterThan(singleEstimate.totalCalls);
    // But wall-clock estimate should be less than 6x (due to parallelism)
    expect(clipEstimate.estimatedMinutes[1]).toBeLessThan(
      singleEstimate.estimatedMinutes[1] * 6,
    );
  });
});
