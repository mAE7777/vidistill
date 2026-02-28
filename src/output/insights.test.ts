import { describe, it, expect } from 'vitest';
import { writeInsights } from './insights.js';
import type { SegmentResult, ImplicitSignals } from '../types/index.js';

function makeSegment(index: number, pass3d: ImplicitSignals | null = null): SegmentResult {
  return { index, pass1: null, pass2: null, pass3d };
}

const FULL_SIGNALS: ImplicitSignals = {
  emotional_shifts: [
    { timestamp: '00:05:00', from_state: 'neutral', to_state: 'excited', trigger: 'Product demo results' },
    { timestamp: '00:30:00', from_state: 'excited', to_state: 'concerned', trigger: 'Timeline discussion' },
  ],
  questions_implicit: [
    'Are we confident in the timeline?',
    'Does the team have enough resources?',
  ],
  decisions_implicit: [
    'The team has agreed to use TypeScript going forward.',
  ],
  tasks_assigned: [],
  emphasis_patterns: [
    {
      concept: 'Performance',
      times_mentioned: 5,
      timestamps: ['00:10:00', '00:15:00', '00:20:00', '00:25:00', '00:28:00'],
      significance: 'Recurring concern about latency targets',
    },
    {
      concept: 'Testing',
      times_mentioned: 3,
      timestamps: ['00:12:00', '00:18:00', '00:22:00'],
      significance: 'Emphasis on test coverage before release',
    },
  ],
};

describe('writeInsights', () => {
  it('returns null when no segments have pass3d data', () => {
    const seg = makeSegment(0);
    expect(writeInsights({ segments: [seg] })).toBeNull();
  });

  it('returns null when segments array is empty', () => {
    expect(writeInsights({ segments: [] })).toBeNull();
  });

  it('returns null when pass3d has all empty arrays', () => {
    const emptySignals: ImplicitSignals = {
      emotional_shifts: [],
      questions_implicit: [],
      decisions_implicit: [],
      tasks_assigned: [],
      emphasis_patterns: [],
    };
    const seg = makeSegment(0, emptySignals);
    expect(writeInsights({ segments: [seg] })).toBeNull();
  });

  it('contains heading when insights exist', () => {
    const seg = makeSegment(0, FULL_SIGNALS);
    const result = writeInsights({ segments: [seg] });
    expect(result).toContain('# Insights');
  });

  it('includes emotional shifts section', () => {
    const seg = makeSegment(0, FULL_SIGNALS);
    const result = writeInsights({ segments: [seg] });
    expect(result).toContain('Emotional Shifts');
    expect(result).toContain('neutral → excited');
    expect(result).toContain('Product demo results');
    expect(result).toContain('00:05:00');
  });

  it('includes emphasis patterns section', () => {
    const seg = makeSegment(0, FULL_SIGNALS);
    const result = writeInsights({ segments: [seg] });
    expect(result).toContain('Emphasis Patterns');
    expect(result).toContain('Performance');
    expect(result).toContain('×5');
    expect(result).toContain('Recurring concern about latency targets');
    expect(result).toContain('Testing');
    expect(result).toContain('×3');
  });

  it('sorts emphasis patterns by times_mentioned descending', () => {
    const seg = makeSegment(0, FULL_SIGNALS);
    const result = writeInsights({ segments: [seg] }) ?? '';
    const perfIdx = result.indexOf('Performance');
    const testIdx = result.indexOf('Testing');
    // Performance (×5) should appear before Testing (×3)
    expect(perfIdx).toBeLessThan(testIdx);
  });

  it('includes implicit questions section', () => {
    const seg = makeSegment(0, FULL_SIGNALS);
    const result = writeInsights({ segments: [seg] });
    expect(result).toContain('Implicit Questions');
    expect(result).toContain('Are we confident in the timeline?');
    expect(result).toContain('Does the team have enough resources?');
  });

  it('includes implicit decisions section', () => {
    const seg = makeSegment(0, FULL_SIGNALS);
    const result = writeInsights({ segments: [seg] });
    expect(result).toContain('Implicit Decisions');
    expect(result).toContain('The team has agreed to use TypeScript');
  });

  it('aggregates data from multiple segments', () => {
    const seg0 = makeSegment(0, FULL_SIGNALS);
    const signals2: ImplicitSignals = {
      emotional_shifts: [{ timestamp: '00:45:00', from_state: 'concerned', to_state: 'resolved', trigger: 'Agreement reached' }],
      questions_implicit: ['Will this scale?'],
      decisions_implicit: [],
      tasks_assigned: [],
      emphasis_patterns: [],
    };
    const seg1 = makeSegment(1, signals2);
    const result = writeInsights({ segments: [seg0, seg1] });
    expect(result).toContain('neutral → excited');
    expect(result).toContain('concerned → resolved');
    expect(result).toContain('Will this scale?');
  });

  it('skips segments without pass3d', () => {
    const seg0 = makeSegment(0);
    const seg1 = makeSegment(1, FULL_SIGNALS);
    const result = writeInsights({ segments: [seg0, seg1] });
    expect(result).toContain('Performance');
  });

  it('returns string when insights are present', () => {
    const seg = makeSegment(0, FULL_SIGNALS);
    const result = writeInsights({ segments: [seg] });
    expect(typeof result).toBe('string');
  });
});
