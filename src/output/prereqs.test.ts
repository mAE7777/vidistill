import { describe, it, expect } from 'vitest';
import { writePrereqs } from './prereqs.js';
import type { PrerequisiteConcept } from '../types/index.js';

function makeConcept(
  overrides: Partial<PrerequisiteConcept> = {},
): PrerequisiteConcept {
  return {
    concept: 'TypeScript',
    assumed_knowledge_level: 'intermediate',
    brief_explanation: 'Statically typed superset of JavaScript.',
    timestamp_first_assumed: '00:01:30',
    ...overrides,
  };
}

describe('writePrereqs', () => {
  it('returns null when prerequisites is undefined', () => {
    expect(writePrereqs({ prerequisites: undefined })).toBeNull();
  });

  it('returns null when prerequisites is an empty array', () => {
    expect(writePrereqs({ prerequisites: [] })).toBeNull();
  });

  it('returns a string when prerequisites are provided', () => {
    const result = writePrereqs({ prerequisites: [makeConcept()] });
    expect(typeof result).toBe('string');
  });

  it('includes the title heading', () => {
    const result = writePrereqs({ prerequisites: [makeConcept()] });
    expect(result).toContain('# Prerequisites');
  });

  it('includes concept name as heading', () => {
    const result = writePrereqs({ prerequisites: [makeConcept({ concept: 'React' })] });
    expect(result).toContain('### React');
  });

  it('includes brief explanation', () => {
    const result = writePrereqs({
      prerequisites: [makeConcept({ brief_explanation: 'A UI library for building component trees.' })],
    });
    expect(result).toContain('A UI library for building component trees.');
  });

  it('includes timestamp_first_assumed', () => {
    const result = writePrereqs({
      prerequisites: [makeConcept({ timestamp_first_assumed: '00:02:15' })],
    });
    expect(result).toContain('00:02:15');
  });

  it('groups by knowledge level with correct headings', () => {
    const concepts: PrerequisiteConcept[] = [
      makeConcept({ concept: 'Git', assumed_knowledge_level: 'basic' }),
      makeConcept({ concept: 'Node.js', assumed_knowledge_level: 'intermediate' }),
      makeConcept({ concept: 'Compiler Theory', assumed_knowledge_level: 'advanced' }),
    ];
    const result = writePrereqs({ prerequisites: concepts }) ?? '';
    expect(result).toContain('## Advanced Knowledge');
    expect(result).toContain('## Intermediate Knowledge');
    expect(result).toContain('## Basic Knowledge');
  });

  it('renders advanced before intermediate before basic', () => {
    const concepts: PrerequisiteConcept[] = [
      makeConcept({ concept: 'Git', assumed_knowledge_level: 'basic' }),
      makeConcept({ concept: 'Node.js', assumed_knowledge_level: 'intermediate' }),
      makeConcept({ concept: 'Compiler Theory', assumed_knowledge_level: 'advanced' }),
    ];
    const result = writePrereqs({ prerequisites: concepts }) ?? '';
    const advIdx = result.indexOf('## Advanced Knowledge');
    const intIdx = result.indexOf('## Intermediate Knowledge');
    const basicIdx = result.indexOf('## Basic Knowledge');
    expect(advIdx).toBeLessThan(intIdx);
    expect(intIdx).toBeLessThan(basicIdx);
  });

  it('omits level heading when no concepts at that level', () => {
    const result = writePrereqs({
      prerequisites: [makeConcept({ assumed_knowledge_level: 'basic' })],
    }) ?? '';
    expect(result).toContain('## Basic Knowledge');
    expect(result).not.toContain('## Advanced Knowledge');
    expect(result).not.toContain('## Intermediate Knowledge');
  });

  it('renders a single basic concept correctly', () => {
    const result = writePrereqs({
      prerequisites: [
        makeConcept({
          concept: 'HTML',
          assumed_knowledge_level: 'basic',
          brief_explanation: 'HyperText Markup Language for structuring web content.',
          timestamp_first_assumed: '00:00:45',
        }),
      ],
    });
    expect(result).toContain('### HTML');
    expect(result).toContain('HyperText Markup Language');
    expect(result).toContain('00:00:45');
  });

  it('renders multiple concepts at the same level', () => {
    const concepts: PrerequisiteConcept[] = [
      makeConcept({ concept: 'Promises', assumed_knowledge_level: 'intermediate' }),
      makeConcept({ concept: 'Arrow functions', assumed_knowledge_level: 'intermediate' }),
    ];
    const result = writePrereqs({ prerequisites: concepts }) ?? '';
    expect(result).toContain('### Promises');
    expect(result).toContain('### Arrow functions');
    // Only one intermediate heading
    const matches = result.match(/## Intermediate Knowledge/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('does not end with a trailing blank line', () => {
    const result = writePrereqs({ prerequisites: [makeConcept()] }) ?? '';
    expect(result.endsWith('\n\n')).toBe(false);
  });
});
