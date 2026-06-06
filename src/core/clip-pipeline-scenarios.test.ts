/**
 * Comprehensive scenario tests for the clip pipeline.
 * Tests real user scenarios: long videos, various durations, edge cases,
 * overlap handling, timestamp continuity, and shutdown behavior.
 */
import { describe, it, expect } from 'vitest';
import {
  offsetTimestamp,
  offsetSegmentResult,
  deduplicateOverlaps,
} from './clip-pipeline.js';
import type { ResultOverlapInfo } from './clip-pipeline.js';
import { shouldSplitIntoClips, createClipPlan, CLIP_DURATION_SEC, CLIP_OVERLAP_SEC } from './splitter.js';
import { estimateClipApiCalls } from './estimator.js';
import type { SegmentResult, TranscriptEntry } from '../types/index.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTranscriptEntry(timestampSec: number, text: string, speaker = 'SPEAKER_00'): TranscriptEntry {
  const h = Math.floor(timestampSec / 3600);
  const m = Math.floor((timestampSec % 3600) / 60);
  const s = Math.floor(timestampSec % 60);
  const timestamp = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return { timestamp, speaker, text, tone: 'neutral' };
}

function makeSegment(index: number, entries: TranscriptEntry[], timeRange: string): SegmentResult {
  return {
    index,
    pass1: {
      segment_index: index,
      time_range: timeRange,
      transcript_entries: entries,
      speaker_summary: [],
    },
    pass2: {
      segment_index: index,
      time_range: timeRange,
      code_blocks: [],
      visual_notes: [],
      screen_timeline: [],
    },
  };
}

// ── Scenario: 3-hour Bilibili lecture ────────────────────────────────────────

describe('scenario: 3-hour Bilibili lecture (10800s)', () => {
  const duration = 10800;

  it('should split into 9 clips', () => {
    expect(shouldSplitIntoClips(duration)).toBe(true);
    const plan = createClipPlan(duration);
    expect(plan).toHaveLength(9);
  });

  it('clips cover the entire video without gaps', () => {
    const plan = createClipPlan(duration);
    // Verify coverage: each clip starts where the previous one's nominal end is
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].startTime).toBe(i * CLIP_DURATION_SEC);
    }
    expect(plan[0].startTime).toBe(0);
    expect(plan[plan.length - 1].endTime).toBe(duration);
  });

  it('consecutive clips overlap by exactly 30 seconds', () => {
    const plan = createClipPlan(duration);
    for (let i = 0; i < plan.length - 1; i++) {
      const overlap = plan[i].endTime - plan[i + 1].startTime;
      expect(overlap).toBe(CLIP_OVERLAP_SEC);
    }
  });

  it('cost estimate is reasonable for 9 clips', () => {
    const strategy = {
      passes: ['transcript', 'visual', 'code', 'people', 'synthesis'],
      resolution: 'medium',
      segmentMinutes: 10,
    };
    const estimate = estimateClipApiCalls(strategy, 9);
    // 9 clips × (3×2 + 1) = 63 per-clip calls + post (1+3+1+1+1) = 70
    expect(estimate.totalCalls).toBeGreaterThan(60);
    expect(estimate.totalCalls).toBeLessThan(100);
    // Wall-clock with 4 concurrency should be much less than sequential
    expect(estimate.estimatedMinutes[1]).toBeLessThan(estimate.totalCalls * 8 / 60);
  });
});

// ── Scenario: borderline duration (exactly 25 min) ──────────────────────────

describe('scenario: borderline 25-min video (1500s)', () => {
  it('does NOT split at exactly 25 min (threshold is exclusive)', () => {
    expect(shouldSplitIntoClips(1500)).toBe(false);
  });

  it('DOES split at 25 min + 1 second', () => {
    expect(shouldSplitIntoClips(1501)).toBe(true);
    const plan = createClipPlan(1501);
    expect(plan).toHaveLength(2);
  });
});

// ── Scenario: 22-min video — should NOT split ────────────────────────────────

describe('scenario: 22-min video (1320s)', () => {
  it('stays on standard pipeline', () => {
    expect(shouldSplitIntoClips(1320)).toBe(false);
  });
});

// ── Scenario: exactly 40-min video ──────────────────────────────────────────

describe('scenario: 40-min video (2400s)', () => {
  it('splits into 2 clips', () => {
    const plan = createClipPlan(2400);
    expect(plan).toHaveLength(2);
    expect(plan[0].endTime).toBe(1230); // 20:30 with overlap
    expect(plan[1].startTime).toBe(1200);
    expect(plan[1].endTime).toBe(2400);
    expect(plan[1].overlapDuration).toBe(0); // last clip
  });
});

// ── Scenario: timestamp offset continuity ────────────────────────────────────

describe('scenario: timestamp continuity across clip boundaries', () => {
  it('timestamps flow continuously after offsetting', () => {
    // Simulate 2 clips: [0, 20:30] and [20:00, 40:00]
    // Clip 0 has entries at 0:00, 10:00, 19:55 (local time)
    // Clip 1 has entries at 0:00, 5:00, 19:00 (local time)

    const clip0Result = makeSegment(0, [
      makeTranscriptEntry(0, 'Start'),
      makeTranscriptEntry(600, 'Middle of clip 0'),
      makeTranscriptEntry(1195, 'Near end of clip 0'),
    ], '00:00:00-00:20:30');

    const clip1Result = makeSegment(0, [
      makeTranscriptEntry(0, 'Start of clip 1'),
      makeTranscriptEntry(300, 'Middle of clip 1'),
      makeTranscriptEntry(1140, 'Near end of clip 1'),
    ], '00:00:00-00:20:00');

    // Offset clip 0 by 0 (first clip)
    const offset0 = offsetSegmentResult(clip0Result, 0, 0);
    // Offset clip 1 by 1200 (20 min)
    const offset1 = offsetSegmentResult(clip1Result, 1200, 1);

    // Verify clip 0 timestamps unchanged
    expect(offset0.pass1!.transcript_entries[0].timestamp).toBe('00:00:00');
    expect(offset0.pass1!.transcript_entries[2].timestamp).toBe('00:19:55');

    // Verify clip 1 timestamps offset by 20 min
    expect(offset1.pass1!.transcript_entries[0].timestamp).toBe('00:20:00');
    expect(offset1.pass1!.transcript_entries[1].timestamp).toBe('00:25:00');
    expect(offset1.pass1!.transcript_entries[2].timestamp).toBe('00:39:00');

    // Verify time_range offset
    expect(offset1.pass1!.time_range).toBe('00:20:00-00:40:00');
    expect(offset1.pass2!.time_range).toBe('00:20:00-00:40:00');

    // Verify timestamps are monotonically increasing across clips
    const allTimestamps = [
      ...offset0.pass1!.transcript_entries.map(e => e.timestamp),
      ...offset1.pass1!.transcript_entries.map(e => e.timestamp),
    ];
    for (let i = 1; i < allTimestamps.length; i++) {
      expect(allTimestamps[i] >= allTimestamps[i - 1]).toBe(true);
    }
  });
});

// ── Scenario: overlap dedup preserves continuity ─────────────────────────────

describe('scenario: overlap dedup at clip boundaries', () => {
  it('removes ONLY overlap entries from earlier clip, keeps all from later clip', () => {
    // Clip 0: entries at 18:00, 19:30, 20:05 (in overlap), 20:20 (in overlap)
    // Clip 1: entries at 20:00, 20:15, 21:00
    // After dedup: clip 0 keeps [18:00, 19:30], clip 1 keeps all

    const results: SegmentResult[] = [
      makeSegment(0, [
        makeTranscriptEntry(1080, 'Before overlap'),
        makeTranscriptEntry(1170, 'Still before'),
        makeTranscriptEntry(1205, 'In overlap — removed'),
        makeTranscriptEntry(1220, 'Also overlap — removed'),
      ], '00:00:00-00:20:30'),
      makeSegment(1, [
        makeTranscriptEntry(1200, 'Clip 1 overlap start'),
        makeTranscriptEntry(1215, 'Clip 1 in overlap'),
        makeTranscriptEntry(1260, 'After overlap'),
      ], '00:20:00-00:40:00'),
    ];

    const overlapInfos: ResultOverlapInfo[] = [
      { clipIndex: 0, isLastSegmentOfClip: true, nextClipStartTime: 1200 },
      { clipIndex: 1, isLastSegmentOfClip: true, nextClipStartTime: undefined },
    ];

    deduplicateOverlaps(results, overlapInfos);

    expect(results[0].pass1!.transcript_entries).toHaveLength(2);
    expect(results[0].pass1!.transcript_entries[0].text).toBe('Before overlap');
    expect(results[0].pass1!.transcript_entries[1].text).toBe('Still before');

    // Clip 1 is completely untouched
    expect(results[1].pass1!.transcript_entries).toHaveLength(3);
  });

  it('dedup works with all pass types (pass2, pass3c, pass3d)', () => {
    const results: SegmentResult[] = [
      {
        index: 0,
        pass1: null,
        pass2: {
          segment_index: 0,
          time_range: '00:00:00-00:20:30',
          code_blocks: [
            { timestamp: '00:19:00', filename: 'a.ts', language: 'ts', content: '', screen_type: '', change_type: 'new_file', instructor_explanation: '' },
            { timestamp: '00:20:10', filename: 'b.ts', language: 'ts', content: '', screen_type: '', change_type: 'new_file', instructor_explanation: '' },
          ],
          visual_notes: [
            { timestamp: '00:19:30', visual_type: 'slide', description: 'keep' },
            { timestamp: '00:20:05', visual_type: 'slide', description: 'remove' },
          ],
          screen_timeline: [
            { timestamp: '00:20:15', screen_state: 'editor' },
          ],
        },
        pass3c: {
          messages: [
            { timestamp: '00:20:00', sender: 'User', text: 'in overlap' },
          ],
          links: [
            { url: 'https://example.com', context: 'test', timestamp: '00:15:00' },
            { url: 'https://overlap.com', context: 'test', timestamp: '00:20:20' },
          ],
        },
        pass3d: {
          emotional_shifts: [{ timestamp: '00:20:01', from_state: 'calm', to_state: 'excited', trigger: 'demo' }],
          questions_implicit: [],
          decisions_implicit: [],
          tasks_assigned: [{ timestamp: '00:20:25', assignee: 'Bob', task: 'review', deadline: '' }],
          emphasis_patterns: [
            { concept: 'testing', times_mentioned: 3, timestamps: ['00:05:00', '00:15:00', '00:20:05'], significance: '' },
          ],
        },
      },
      { index: 1, pass1: null, pass2: null },
    ];

    const overlapInfos: ResultOverlapInfo[] = [
      { clipIndex: 0, isLastSegmentOfClip: true, nextClipStartTime: 1200 },
      { clipIndex: 1, isLastSegmentOfClip: true, nextClipStartTime: undefined },
    ];

    deduplicateOverlaps(results, overlapInfos);

    // pass2
    expect(results[0].pass2!.code_blocks).toHaveLength(1);
    expect(results[0].pass2!.code_blocks[0].timestamp).toBe('00:19:00');
    expect(results[0].pass2!.visual_notes).toHaveLength(1);
    expect(results[0].pass2!.visual_notes[0].description).toBe('keep');
    expect(results[0].pass2!.screen_timeline).toHaveLength(0);

    // pass3c
    expect(results[0].pass3c!.messages).toHaveLength(0);
    expect(results[0].pass3c!.links).toHaveLength(1);
    expect(results[0].pass3c!.links[0].url).toBe('https://example.com');

    // pass3d
    expect(results[0].pass3d!.emotional_shifts).toHaveLength(0);
    expect(results[0].pass3d!.tasks_assigned).toHaveLength(0);
    expect(results[0].pass3d!.emphasis_patterns).toHaveLength(1);
    expect(results[0].pass3d!.emphasis_patterns[0].timestamps).toEqual(['00:05:00', '00:15:00']);
  });
});

// ── Scenario: single-clip edge case ─────────────────────────────────────────

describe('scenario: single clip (26 min video)', () => {
  it('createClipPlan returns 2 clips for 26 min (just over threshold)', () => {
    const plan = createClipPlan(26 * 60);
    expect(plan).toHaveLength(2);
    // First clip: [0, 20:30]
    expect(plan[0].startTime).toBe(0);
    expect(plan[0].endTime).toBe(1230);
    // Second clip: [20:00, 26:00]
    expect(plan[1].startTime).toBe(1200);
    expect(plan[1].endTime).toBe(1560);
  });
});

// ── Scenario: very long video ────────────────────────────────────────────────

describe('scenario: 8-hour conference recording (28800s)', () => {
  it('splits into 24 clips', () => {
    const plan = createClipPlan(28800);
    expect(plan).toHaveLength(24);
  });

  it('last clip ends at exact duration', () => {
    const plan = createClipPlan(28800);
    expect(plan[plan.length - 1].endTime).toBe(28800);
    expect(plan[plan.length - 1].overlapDuration).toBe(0);
  });

  it('total coverage minus overlaps equals video duration', () => {
    const plan = createClipPlan(28800);
    const totalOverlap = plan.reduce((sum, c) => sum + c.overlapDuration, 0);
    const totalCoverage = plan.reduce((sum, c) => sum + (c.endTime - c.startTime), 0);
    expect(totalCoverage - totalOverlap).toBe(28800);
  });
});

// ── Scenario: offset edge cases ──────────────────────────────────────────────

describe('scenario: timestamp offset edge cases', () => {
  it('handles hour boundaries correctly', () => {
    expect(offsetTimestamp('55:00', 600)).toBe('01:05:00'); // 55min + 10min crosses hour
  });

  it('handles multi-hour offsets', () => {
    expect(offsetTimestamp('00:30:00', 7200)).toBe('02:30:00'); // +2 hours
  });

  it('preserves zero timestamps with zero offset', () => {
    expect(offsetTimestamp('00:00', 0)).toBe('00:00');
  });

  it('handles timestamp_end in code blocks', () => {
    const result: SegmentResult = {
      index: 0,
      pass1: null,
      pass2: {
        segment_index: 0,
        time_range: '00:00:00-00:20:00',
        code_blocks: [{
          timestamp: '05:00',
          timestamp_end: '08:00',
          filename: 'app.ts',
          language: 'typescript',
          content: 'const x = 1;',
          screen_type: 'editor',
          change_type: 'modification',
          instructor_explanation: '',
        }],
        visual_notes: [],
        screen_timeline: [],
      },
    };

    const shifted = offsetSegmentResult(result, 3600, 5); // +1 hour
    expect(shifted.pass2!.code_blocks[0].timestamp).toBe('01:05:00');
    expect(shifted.pass2!.code_blocks[0].timestamp_end).toBe('01:08:00');
  });
});

// ── Scenario: speaker identity across clips ─────────────────────────────────

describe('scenario: speaker labels survive clip boundaries', () => {
  it('different speaker IDs from different clips are preserved for reconciliation', () => {
    // Clip 0: SPEAKER_00 (Alice), SPEAKER_01 (Bob)
    // Clip 1: SPEAKER_00 (Alice), SPEAKER_01 (Charlie)
    // After offsetting, both clips' speakers should be in the combined results
    // Speaker reconciliation (runWholeVideoPasses) handles merging

    const clip0 = makeSegment(0, [
      makeTranscriptEntry(300, 'Hello from Alice', 'SPEAKER_00 (Alice)'),
      makeTranscriptEntry(600, 'Hello from Bob', 'SPEAKER_01 (Bob)'),
    ], '00:00:00-00:20:00');

    const clip1 = makeSegment(0, [
      makeTranscriptEntry(0, 'Alice again', 'SPEAKER_00 (Alice)'),
      makeTranscriptEntry(300, 'Hi from Charlie', 'SPEAKER_01 (Charlie)'),
    ], '00:00:00-00:20:00');

    const offset0 = offsetSegmentResult(clip0, 0, 0);
    const offset1 = offsetSegmentResult(clip1, 1200, 1);

    // All speakers preserved
    expect(offset0.pass1!.transcript_entries[0].speaker).toBe('SPEAKER_00 (Alice)');
    expect(offset0.pass1!.transcript_entries[1].speaker).toBe('SPEAKER_01 (Bob)');
    expect(offset1.pass1!.transcript_entries[0].speaker).toBe('SPEAKER_00 (Alice)');
    expect(offset1.pass1!.transcript_entries[1].speaker).toBe('SPEAKER_01 (Charlie)');

    // segment_index correctly updated
    expect(offset0.pass1!.segment_index).toBe(0);
    expect(offset1.pass1!.segment_index).toBe(1);
  });
});

// ── Scenario: partial clip (last clip shorter than full duration) ────────────

describe('scenario: last clip is shorter than full duration', () => {
  it('handles 65-min video where last clip is only 5 min', () => {
    const plan = createClipPlan(3900); // 65 min
    expect(plan).toHaveLength(4);

    // Last clip: [60:00, 65:00] — only 5 min, no overlap
    const last = plan[3];
    expect(last.startTime).toBe(3600);
    expect(last.endTime).toBe(3900);
    expect(last.overlapDuration).toBe(0);
    expect(last.endTime - last.startTime).toBe(300); // 5 min
  });
});

// ── Scenario: verify immutability of offsetSegmentResult ─────────────────────

describe('scenario: offsetSegmentResult immutability', () => {
  it('original result is not mutated by offset operation', () => {
    const original = makeSegment(0, [
      makeTranscriptEntry(100, 'test'),
    ], '00:00:00-00:10:00');

    const originalTimestamp = original.pass1!.transcript_entries[0].timestamp;
    const originalRange = original.pass1!.time_range;
    const originalIndex = original.index;

    offsetSegmentResult(original, 7200, 42);

    expect(original.pass1!.transcript_entries[0].timestamp).toBe(originalTimestamp);
    expect(original.pass1!.time_range).toBe(originalRange);
    expect(original.index).toBe(originalIndex);
  });
});
