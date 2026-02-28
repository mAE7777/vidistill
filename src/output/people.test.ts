import { describe, it, expect } from 'vitest';
import { writePeople } from './people.js';
import type { PeopleExtraction, Participant } from '../types/index.js';

const ALICE: Participant = {
  name: 'Alice Chen',
  role: 'Engineering Lead',
  organization: 'Acme Corp',
  speaking_segments: ['00:00:00-00:05:00', '00:15:00-00:20:00'],
  contact_info: ['alice@acme.com'],
  contributions: ['Proposed the microservices architecture', 'Led the Q&A session'],
};

const BOB: Participant = {
  name: 'Bob Smith',
  role: 'Product Manager',
  organization: 'Acme Corp',
  speaking_segments: ['00:05:00-00:10:00'],
  contact_info: [],
  contributions: ['Defined product requirements'],
};

const CAROL: Participant = {
  name: 'Carol Davis',
  role: '',
  organization: '',
  speaking_segments: [],
  contact_info: [],
  contributions: [],
};

const THREE_PARTICIPANTS: PeopleExtraction = {
  participants: [ALICE, BOB, CAROL],
  relationships: ['Alice is Bob\'s manager', 'Carol is an external consultant'],
};

describe('writePeople', () => {
  it('returns null when peopleExtraction is null', () => {
    expect(writePeople({ peopleExtraction: null })).toBeNull();
  });

  it('returns null when peopleExtraction is undefined', () => {
    expect(writePeople({ peopleExtraction: undefined })).toBeNull();
  });

  it('returns null when participants array is empty', () => {
    expect(writePeople({ peopleExtraction: { participants: [], relationships: [] } })).toBeNull();
  });

  it('lists all 3 participants when given 3', () => {
    const result = writePeople({ peopleExtraction: THREE_PARTICIPANTS });
    expect(result).toContain('Alice Chen');
    expect(result).toContain('Bob Smith');
    expect(result).toContain('Carol Davis');
  });

  it('includes participant roles', () => {
    const result = writePeople({ peopleExtraction: THREE_PARTICIPANTS });
    expect(result).toContain('Engineering Lead');
    expect(result).toContain('Product Manager');
  });

  it('includes organizations', () => {
    const result = writePeople({ peopleExtraction: THREE_PARTICIPANTS });
    expect(result).toContain('Acme Corp');
  });

  it('includes contributions', () => {
    const result = writePeople({ peopleExtraction: THREE_PARTICIPANTS });
    expect(result).toContain('Proposed the microservices architecture');
    expect(result).toContain('Defined product requirements');
  });

  it('includes speaking segments', () => {
    const result = writePeople({ peopleExtraction: THREE_PARTICIPANTS });
    expect(result).toContain('00:00:00-00:05:00');
  });

  it('includes contact info when present', () => {
    const result = writePeople({ peopleExtraction: THREE_PARTICIPANTS });
    expect(result).toContain('alice@acme.com');
  });

  it('includes relationships section', () => {
    const result = writePeople({ peopleExtraction: THREE_PARTICIPANTS });
    expect(result).toContain('Relationships');
    expect(result).toContain("Alice is Bob's manager");
    expect(result).toContain('Carol is an external consultant');
  });

  it('omits relationships section when empty', () => {
    const result = writePeople({
      peopleExtraction: { participants: [ALICE], relationships: [] },
    });
    expect(result).not.toContain('Relationships');
  });

  it('contains heading', () => {
    const result = writePeople({ peopleExtraction: THREE_PARTICIPANTS });
    expect(result).toContain('# Participants');
  });

  it('works with single participant', () => {
    const result = writePeople({
      peopleExtraction: { participants: [ALICE], relationships: [] },
    });
    expect(result).toContain('Alice Chen');
    expect(typeof result).toBe('string');
  });

  it('handles participant with no optional fields', () => {
    const result = writePeople({
      peopleExtraction: { participants: [CAROL], relationships: [] },
    });
    expect(result).toContain('Carol Davis');
    expect(typeof result).toBe('string');
  });
});
