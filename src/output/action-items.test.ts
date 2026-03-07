import { describe, it, expect } from 'vitest';
import { writeActionItems } from './action-items.js';
import type { SegmentResult, SynthesisResult, ImplicitSignals } from '../types/index.js';

function makeSegment(index: number, pass3d: ImplicitSignals | null = null): SegmentResult {
  return { index, pass1: null, pass2: null, pass3d };
}

const SYNTHESIS_WITH_ITEMS: SynthesisResult = {
  overview: 'Overview',
  key_decisions: [],
  key_concepts: [],
  action_items: [
    { item: 'Update the documentation', timestamp: '00:10:00', mentioned_by: 'Alice' },
    { item: 'Create a pull request', timestamp: '00:12:00', mentioned_by: '' },
  ],
  questions_raised: [],
  suggestions: [],
  topics: [],
  prerequisites: [],
  files_to_generate: [],
};

const PASS3D_WITH_TASKS: ImplicitSignals = {
  emotional_shifts: [],
  questions_implicit: [],
  decisions_implicit: [],
  tasks_assigned: [
    { timestamp: '00:20:00', assignee: 'Bob', task: 'Deploy to staging', deadline: 'Friday' },
    { timestamp: '00:22:00', assignee: '', task: 'Review the PR', deadline: '' },
  ],
  emphasis_patterns: [],
};

describe('writeActionItems', () => {
  it('returns null when no synthesis and no pass3d tasks', () => {
    const seg = makeSegment(0);
    expect(writeActionItems({ segments: [seg] })).toBeNull();
  });

  it('returns null when synthesis has empty action_items and no pass3d', () => {
    const synthesis: SynthesisResult = { ...SYNTHESIS_WITH_ITEMS, action_items: [] };
    const seg = makeSegment(0);
    expect(writeActionItems({ segments: [seg], synthesisResult: synthesis })).toBeNull();
  });

  it('returns null when segments array is empty and no synthesis items', () => {
    expect(writeActionItems({ segments: [] })).toBeNull();
  });

  it('contains heading when action items exist', () => {
    const result = writeActionItems({ segments: [], synthesisResult: SYNTHESIS_WITH_ITEMS });
    expect(result).toContain('# Action Items');
  });

  it('includes synthesis action items', () => {
    const result = writeActionItems({ segments: [], synthesisResult: SYNTHESIS_WITH_ITEMS });
    expect(result).toContain('Update the documentation');
    expect(result).toContain('00:10:00');
    expect(result).toContain('Alice');
    expect(result).toContain('Create a pull request');
  });

  it('includes checkbox format for action items', () => {
    const result = writeActionItems({ segments: [], synthesisResult: SYNTHESIS_WITH_ITEMS });
    expect(result).toContain('- [ ]');
  });

  it('includes assigned tasks from pass3d', () => {
    const seg = makeSegment(0, PASS3D_WITH_TASKS);
    const result = writeActionItems({ segments: [seg] });
    expect(result).toContain('Deploy to staging');
    expect(result).toContain('Bob');
    expect(result).toContain('Friday');
    expect(result).toContain('Review the PR');
  });

  it('shows both synthesis and assigned tasks sections', () => {
    const seg = makeSegment(0, PASS3D_WITH_TASKS);
    const result = writeActionItems({ segments: [seg], synthesisResult: SYNTHESIS_WITH_ITEMS });
    expect(result).toContain('From Synthesis');
    expect(result).toContain('Assigned Tasks');
  });

  it('aggregates tasks from multiple segments', () => {
    const seg0 = makeSegment(0, PASS3D_WITH_TASKS);
    const seg1 = makeSegment(1, {
      ...PASS3D_WITH_TASKS,
      tasks_assigned: [{ timestamp: '00:30:00', assignee: 'Carol', task: 'Write tests', deadline: '' }],
    });
    const result = writeActionItems({ segments: [seg0, seg1] });
    expect(result).toContain('Deploy to staging');
    expect(result).toContain('Write tests');
    expect(result).toContain('Carol');
  });

  it('skips segments without pass3d', () => {
    const seg0 = makeSegment(0);
    const seg1 = makeSegment(1, PASS3D_WITH_TASKS);
    const result = writeActionItems({ segments: [seg0, seg1] });
    expect(result).toContain('Deploy to staging');
  });

  it('returns string when only synthesis items present', () => {
    const result = writeActionItems({ segments: [], synthesisResult: SYNTHESIS_WITH_ITEMS });
    expect(typeof result).toBe('string');
  });

  it('returns string when only pass3d tasks present', () => {
    const seg = makeSegment(0, PASS3D_WITH_TASKS);
    const result = writeActionItems({ segments: [seg] });
    expect(typeof result).toBe('string');
  });

  it('filters assigned tasks that duplicate synthesis items', () => {
    const synthesis: SynthesisResult = {
      ...SYNTHESIS_WITH_ITEMS,
      action_items: [
        { item: 'Produce a follow-up video', timestamp: '00:19:00', mentioned_by: 'Alice' },
      ],
    };
    const pass3d: ImplicitSignals = {
      ...PASS3D_WITH_TASKS,
      tasks_assigned: [
        { timestamp: '00:19:00', assignee: 'Alice', task: 'Produce a follow-up video explaining the details', deadline: '' },
      ],
    };
    const seg = makeSegment(0, pass3d);
    const result = writeActionItems({ segments: [seg], synthesisResult: synthesis });
    expect(result).toContain('From Synthesis');
    expect(result).not.toContain('Assigned Tasks');
  });

  it('keeps genuinely different assigned tasks alongside synthesis items', () => {
    const synthesis: SynthesisResult = {
      ...SYNTHESIS_WITH_ITEMS,
      action_items: [
        { item: 'Produce a follow-up video', timestamp: '00:19:00', mentioned_by: 'Alice' },
      ],
    };
    const pass3d: ImplicitSignals = {
      ...PASS3D_WITH_TASKS,
      tasks_assigned: [
        { timestamp: '00:05:00', assignee: 'Bob', task: 'Write unit tests for the API', deadline: 'Friday' },
      ],
    };
    const seg = makeSegment(0, pass3d);
    const result = writeActionItems({ segments: [seg], synthesisResult: synthesis });
    expect(result).toContain('From Synthesis');
    expect(result).toContain('Assigned Tasks');
    expect(result).toContain('Write unit tests for the API');
  });
});
