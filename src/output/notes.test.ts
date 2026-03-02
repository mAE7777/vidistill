import { describe, it, expect } from 'vitest';
import { writeNotes } from './notes.js';
import type { SynthesisResult } from '../types/index.js';

const FULL_SYNTHESIS: SynthesisResult = {
  overview: 'A discussion about the new architecture.',
  key_decisions: [
    { decision: 'Use microservices', timestamp: '00:05:00', context: 'After weighing monolith vs. microservices' },
  ],
  key_concepts: [
    { concept: 'Event sourcing', explanation: 'Store state as a sequence of events', timestamp: '00:10:00' },
    { concept: 'CQRS', explanation: 'Separate read and write models', timestamp: '00:15:00' },
  ],
  action_items: [
    { item: 'Write ADR for event sourcing', timestamp: '00:20:00', mentioned_by: 'Alice' },
  ],
  questions_raised: [
    { question: 'How do we handle schema migrations?', timestamp: '00:25:00', answered: false },
    { question: 'Which message broker?', timestamp: '00:30:00', answered: true },
  ],
  suggestions: [],
  topics: [
    {
      title: 'Architecture Overview',
      timestamps: ['00:00:00', '00:05:00'],
      summary: 'Covered high-level system design.',
      key_points: ['Stateless services', 'Event-driven'],
    },
  ],
  files_to_generate: [],
  prerequisites: [],
};

describe('writeNotes', () => {
  it('returns null when synthesisResult is null', () => {
    expect(writeNotes({ synthesisResult: null })).toBeNull();
  });

  it('returns null when synthesisResult is undefined', () => {
    expect(writeNotes({ synthesisResult: undefined })).toBeNull();
  });

  it('returns null when all data arrays are empty', () => {
    const empty: SynthesisResult = {
      overview: 'Some overview',
      key_decisions: [],
      key_concepts: [],
      action_items: [],
      questions_raised: [],
      suggestions: [],
      topics: [],
      files_to_generate: [],
      prerequisites: [],
    };
    expect(writeNotes({ synthesisResult: empty })).toBeNull();
  });

  it('contains heading when there is content', () => {
    const result = writeNotes({ synthesisResult: FULL_SYNTHESIS });
    expect(result).toContain('# Notes');
  });

  it('includes overview text', () => {
    const result = writeNotes({ synthesisResult: FULL_SYNTHESIS });
    expect(result).toContain('A discussion about the new architecture.');
  });

  it('includes key concepts with timestamps and explanations', () => {
    const result = writeNotes({ synthesisResult: FULL_SYNTHESIS });
    expect(result).toContain('Event sourcing');
    expect(result).toContain('00:10:00');
    expect(result).toContain('Store state as a sequence of events');
    expect(result).toContain('CQRS');
    expect(result).toContain('Separate read and write models');
  });

  it('includes key decisions with timestamps', () => {
    const result = writeNotes({ synthesisResult: FULL_SYNTHESIS });
    expect(result).toContain('Use microservices');
    expect(result).toContain('00:05:00');
    expect(result).toContain('After weighing monolith vs. microservices');
  });

  it('includes topics with key points', () => {
    const result = writeNotes({ synthesisResult: FULL_SYNTHESIS });
    expect(result).toContain('Architecture Overview');
    expect(result).toContain('Stateless services');
    expect(result).toContain('Event-driven');
  });

  it('includes questions with answered status', () => {
    const result = writeNotes({ synthesisResult: FULL_SYNTHESIS });
    expect(result).toContain('How do we handle schema migrations?');
    expect(result).toContain('(open)');
    expect(result).toContain('Which message broker?');
    expect(result).toContain('(answered)');
  });

  it('includes action items from synthesis', () => {
    const result = writeNotes({ synthesisResult: FULL_SYNTHESIS });
    expect(result).toContain('Write ADR for event sourcing');
    expect(result).toContain('Alice');
  });

  it('returns string when concepts present even if other arrays empty', () => {
    const s: SynthesisResult = {
      ...FULL_SYNTHESIS,
      key_decisions: [],
      action_items: [],
      questions_raised: [],
      topics: [],
    };
    const result = writeNotes({ synthesisResult: s });
    expect(typeof result).toBe('string');
    expect(result).toContain('Event sourcing');
  });

  it('returns string when only decisions are present', () => {
    const s: SynthesisResult = {
      ...FULL_SYNTHESIS,
      key_concepts: [],
      action_items: [],
      questions_raised: [],
      topics: [],
    };
    const result = writeNotes({ synthesisResult: s });
    expect(result).not.toBeNull();
    expect(result).toContain('Use microservices');
  });
});
