import { describe, expect, it } from 'vitest';
import type { PipelineResult } from '../types/index.js';
import { normalizePipelineTimestamps, normalizeTimestamp } from './timestamps.js';

describe('timestamp normalization', () => {
  it('keeps valid HH:MM:SS timestamps inside duration', () => {
    expect(normalizeTimestamp('00:50:00', { durationSeconds: 3447 })).toBe('00:50:00');
  });

  it('repairs MM:SS:frame-style timestamps that exceed video duration', () => {
    expect(normalizeTimestamp('20:06:58', { durationSeconds: 3447 })).toBe('00:20:06');
    expect(normalizeTimestamp('13:30:00', { durationSeconds: 3447 })).toBe('00:13:30');
  });

  it('keeps real hour timestamps for long videos', () => {
    expect(normalizeTimestamp('01:05:30', { durationSeconds: 7200 })).toBe('01:05:30');
  });

  it('repairs segment-relative MM:SS:frame timestamps using segment context', () => {
    expect(normalizeTimestamp('06:44:00', {
      durationSeconds: 3447,
      segmentStartSeconds: 3000,
      segmentEndSeconds: 3447,
    })).toBe('00:56:44');
  });

  it('normalizes pipeline pass2 regions and synthesis timestamps before output', () => {
    const result: PipelineResult = {
      segments: [
        {
          index: 5,
          pass1: null,
          pass2: {
            segment_index: 5,
            time_range: '00:50:00 - 00:57:27',
            code_blocks: [],
            visual_notes: [{ timestamp: '06:44:00', visual_type: 'other', description: 'chat panel' }],
            screen_timeline: [],
            visual_regions: [
              {
                timestamp: '06:44:00',
                region_type: 'chat',
                label: 'Join the conversation',
                visible: true,
                sample_text: 'question from audience',
                confidence: 0.9,
              },
            ],
          },
        },
      ],
      passesRun: ['pass2'],
      errors: [],
      synthesisResult: {
        overview: 'Overview',
        key_decisions: [{ decision: 'D', timestamp: '20:06:58', context: 'C' }],
        key_concepts: [],
        action_items: [],
        questions_raised: [],
        suggestions: [],
        topics: [{ title: 'Topic', timestamps: ['37:47:00'], summary: 'S', key_points: [] }],
        files_to_generate: [],
        prerequisites: [],
      },
      apiCallCount: 0,
    };

    normalizePipelineTimestamps(result, 3447);

    expect(result.segments[0].pass2?.visual_notes[0].timestamp).toBe('00:56:44');
    expect(result.segments[0].pass2?.visual_regions?.[0].timestamp).toBe('00:56:44');
    expect(result.synthesisResult?.key_decisions[0].timestamp).toBe('00:20:06');
    expect(result.synthesisResult?.topics[0].timestamps[0]).toBe('00:37:47');
  });
});
