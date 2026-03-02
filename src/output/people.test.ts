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

describe('writePeople — deduplication', () => {
  // AC1: SPEAKER_02 and SPEAKER_05 both mapping to "Kristian" → one entry
  it('merges two SPEAKER_XX participants that map to the same name', () => {
    const sp02: Participant = {
      name: 'SPEAKER_02',
      role: 'Student',
      organization: '',
      speaking_segments: ['00:05:00-00:10:00'],
      contact_info: [],
      contributions: ['Led Q&A'],
    };
    const sp05: Participant = {
      name: 'SPEAKER_05',
      role: '',
      organization: '',
      speaking_segments: ['00:15:00-00:20:00'],
      contact_info: [],
      contributions: ['Asked about pricing'],
    };
    const extraction: PeopleExtraction = {
      participants: [sp02, sp05],
      relationships: [],
    };
    const speakerMapping = { SPEAKER_02: 'Kristian', SPEAKER_05: 'Kristian' };

    const result = writePeople({ peopleExtraction: extraction, speakerMapping });

    // Only one "Kristian" heading (## 1. Kristian)
    const matches = result?.match(/## \d+\. Kristian/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  // AC2: contributions are merged and deduplicated
  it('combines contributions from merged participants', () => {
    const sp02: Participant = {
      name: 'SPEAKER_02',
      role: '',
      organization: '',
      speaking_segments: [],
      contact_info: [],
      contributions: ['Led Q&A'],
    };
    const sp05: Participant = {
      name: 'SPEAKER_05',
      role: '',
      organization: '',
      speaking_segments: [],
      contact_info: [],
      contributions: ['Asked about pricing'],
    };
    const extraction: PeopleExtraction = { participants: [sp02, sp05], relationships: [] };
    const speakerMapping = { SPEAKER_02: 'Kristian', SPEAKER_05: 'Kristian' };

    const result = writePeople({ peopleExtraction: extraction, speakerMapping });

    expect(result).toContain('Led Q&A');
    expect(result).toContain('Asked about pricing');
  });

  // AC2: duplicate contributions are deduplicated
  it('deduplicates identical contributions on merge', () => {
    const sp02: Participant = {
      name: 'SPEAKER_02',
      role: '',
      organization: '',
      speaking_segments: [],
      contact_info: [],
      contributions: ['Led Q&A', 'Shared idea'],
    };
    const sp05: Participant = {
      name: 'SPEAKER_05',
      role: '',
      organization: '',
      speaking_segments: [],
      contact_info: [],
      contributions: ['Led Q&A', 'Asked about pricing'],
    };
    const extraction: PeopleExtraction = { participants: [sp02, sp05], relationships: [] };
    const speakerMapping = { SPEAKER_02: 'Kristian', SPEAKER_05: 'Kristian' };

    const result = writePeople({ peopleExtraction: extraction, speakerMapping });

    // "Led Q&A" should appear exactly once
    const ledQaCount = (result?.match(/Led Q&A/g) ?? []).length;
    expect(ledQaCount).toBe(1);
    expect(result).toContain('Shared idea');
    expect(result).toContain('Asked about pricing');
  });

  // AC3: speaking_segments are concatenated (no dedup — different time ranges)
  it('concatenates speaking_segments from merged participants', () => {
    const sp02: Participant = {
      name: 'SPEAKER_02',
      role: '',
      organization: '',
      speaking_segments: ['00:05:00-00:10:00'],
      contact_info: [],
      contributions: [],
    };
    const sp05: Participant = {
      name: 'SPEAKER_05',
      role: '',
      organization: '',
      speaking_segments: ['00:15:00-00:20:00'],
      contact_info: [],
      contributions: [],
    };
    const extraction: PeopleExtraction = { participants: [sp02, sp05], relationships: [] };
    const speakerMapping = { SPEAKER_02: 'Kristian', SPEAKER_05: 'Kristian' };

    const result = writePeople({ peopleExtraction: extraction, speakerMapping });

    expect(result).toContain('00:05:00-00:10:00');
    expect(result).toContain('00:15:00-00:20:00');
  });

  // AC4: role — keep the longer string
  it('keeps the longer role when merging', () => {
    const sp02: Participant = {
      name: 'SPEAKER_02',
      role: 'Student',
      organization: '',
      speaking_segments: [],
      contact_info: [],
      contributions: [],
    };
    const sp05: Participant = {
      name: 'SPEAKER_05',
      role: 'CS student at NYU',
      organization: '',
      speaking_segments: [],
      contact_info: [],
      contributions: [],
    };
    const extraction: PeopleExtraction = { participants: [sp02, sp05], relationships: [] };
    const speakerMapping = { SPEAKER_02: 'Kristian', SPEAKER_05: 'Kristian' };

    const result = writePeople({ peopleExtraction: extraction, speakerMapping });

    expect(result).toContain('CS student at NYU');
    expect(result).not.toContain('**Role:** Student\n');
  });

  // AC5: declined merge pair → two separate entries even if both map to same name
  it('keeps two separate entries when merge was declined', () => {
    const sp02: Participant = {
      name: 'SPEAKER_02',
      role: 'Student',
      organization: '',
      speaking_segments: ['00:05:00-00:10:00'],
      contact_info: [],
      contributions: ['Led Q&A'],
    };
    const sp05: Participant = {
      name: 'SPEAKER_05',
      role: '',
      organization: '',
      speaking_segments: ['00:15:00-00:20:00'],
      contact_info: [],
      contributions: ['Asked about pricing'],
    };
    const extraction: PeopleExtraction = { participants: [sp02, sp05], relationships: [] };
    const speakerMapping = { SPEAKER_02: 'Kristian', SPEAKER_05: 'Kristian' };
    const declinedMerges: [string, string][] = [['SPEAKER_02', 'SPEAKER_05']];

    const result = writePeople({ peopleExtraction: extraction, speakerMapping, declinedMerges });

    // Two "Kristian" headings since merge was declined
    const matches = result?.match(/## \d+\. Kristian/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  // AC5: declined merge respects reversed ordering too
  it('keeps two separate entries when declined merge is stored in reversed order', () => {
    const sp02: Participant = {
      name: 'SPEAKER_02',
      role: '',
      organization: '',
      speaking_segments: [],
      contact_info: [],
      contributions: ['Led Q&A'],
    };
    const sp05: Participant = {
      name: 'SPEAKER_05',
      role: '',
      organization: '',
      speaking_segments: [],
      contact_info: [],
      contributions: ['Asked about pricing'],
    };
    const extraction: PeopleExtraction = { participants: [sp02, sp05], relationships: [] };
    const speakerMapping = { SPEAKER_02: 'Kristian', SPEAKER_05: 'Kristian' };
    // Note: reversed order from how they appear
    const declinedMerges: [string, string][] = [['SPEAKER_05', 'SPEAKER_02']];

    const result = writePeople({ peopleExtraction: extraction, speakerMapping, declinedMerges });

    const matches = result?.match(/## \d+\. Kristian/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  // AC6: participant with no merge partner appears unchanged
  it('renders a solo participant unchanged', () => {
    const sp01: Participant = {
      name: 'SPEAKER_01',
      role: 'Host',
      organization: 'Event Co',
      speaking_segments: ['00:00:00-00:05:00'],
      contact_info: ['host@example.com'],
      contributions: ['Opened the session'],
    };
    const extraction: PeopleExtraction = { participants: [sp01], relationships: [] };
    const speakerMapping = { SPEAKER_01: 'Jordan' };

    const result = writePeople({ peopleExtraction: extraction, speakerMapping });

    expect(result).toContain('Jordan');
    expect(result).toContain('Host');
    expect(result).toContain('Event Co');
    expect(result).toContain('host@example.com');
    expect(result).toContain('Opened the session');
    expect(result).toContain('00:00:00-00:05:00');
  });

  it('does not merge non-SPEAKER_XX participants with the same mapped name', () => {
    const p1: Participant = {
      name: 'K Iphone',
      role: 'Speaker',
      organization: '',
      speaking_segments: ['00:01:00-00:02:00'],
      contact_info: [],
      contributions: ['Point A'],
    };
    const p2: Participant = {
      name: 'K Laptop',
      role: 'Presenter',
      organization: '',
      speaking_segments: ['00:03:00-00:04:00'],
      contact_info: [],
      contributions: ['Point B'],
    };
    const extraction: PeopleExtraction = { participants: [p1, p2], relationships: [] };
    // No SPEAKER_XX keys — no merge should happen
    const speakerMapping = { 'K Iphone': 'Kristian', 'K Laptop': 'Kristian' };

    const result = writePeople({ peopleExtraction: extraction, speakerMapping });

    // Both should appear as "Kristian" but as separate entries
    const matches = result?.match(/## \d+\. Kristian/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it('merges contact_info and deduplicates', () => {
    const sp02: Participant = {
      name: 'SPEAKER_02',
      role: '',
      organization: '',
      speaking_segments: [],
      contact_info: ['k@example.com', 'shared@example.com'],
      contributions: [],
    };
    const sp05: Participant = {
      name: 'SPEAKER_05',
      role: '',
      organization: '',
      speaking_segments: [],
      contact_info: ['shared@example.com', 'k2@example.com'],
      contributions: [],
    };
    const extraction: PeopleExtraction = { participants: [sp02, sp05], relationships: [] };
    const speakerMapping = { SPEAKER_02: 'Kristian', SPEAKER_05: 'Kristian' };

    const result = writePeople({ peopleExtraction: extraction, speakerMapping });

    expect(result).toContain('k@example.com');
    expect(result).toContain('shared@example.com');
    expect(result).toContain('k2@example.com');

    // shared@example.com should appear only once
    const sharedCount = (result?.match(/shared@example\.com/g) ?? []).length;
    expect(sharedCount).toBe(1);
  });

  it('keeps the longer organization when merging', () => {
    const sp02: Participant = {
      name: 'SPEAKER_02',
      role: '',
      organization: 'NYU',
      speaking_segments: [],
      contact_info: [],
      contributions: [],
    };
    const sp05: Participant = {
      name: 'SPEAKER_05',
      role: '',
      organization: 'New York University',
      speaking_segments: [],
      contact_info: [],
      contributions: [],
    };
    const extraction: PeopleExtraction = { participants: [sp02, sp05], relationships: [] };
    const speakerMapping = { SPEAKER_02: 'Kristian', SPEAKER_05: 'Kristian' };

    const result = writePeople({ peopleExtraction: extraction, speakerMapping });

    expect(result).toContain('New York University');
    // The short one should not appear as a standalone org
    expect(result).not.toContain('**Organization:** NYU');
  });

  it('merges three participants mapping to the same name', () => {
    const sp01: Participant = {
      name: 'SPEAKER_01',
      role: 'A',
      organization: '',
      speaking_segments: ['00:01:00-00:02:00'],
      contact_info: [],
      contributions: ['Contribution A'],
    };
    const sp03: Participant = {
      name: 'SPEAKER_03',
      role: 'AB',
      organization: '',
      speaking_segments: ['00:03:00-00:04:00'],
      contact_info: [],
      contributions: ['Contribution B'],
    };
    const sp07: Participant = {
      name: 'SPEAKER_07',
      role: '',
      organization: '',
      speaking_segments: ['00:05:00-00:06:00'],
      contact_info: [],
      contributions: ['Contribution C'],
    };
    const extraction: PeopleExtraction = {
      participants: [sp01, sp03, sp07],
      relationships: [],
    };
    const speakerMapping = {
      SPEAKER_01: 'Taylor',
      SPEAKER_03: 'Taylor',
      SPEAKER_07: 'Taylor',
    };

    const result = writePeople({ peopleExtraction: extraction, speakerMapping });

    const matches = result?.match(/## \d+\. Taylor/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(result).toContain('Contribution A');
    expect(result).toContain('Contribution B');
    expect(result).toContain('Contribution C');
    // Longest role kept
    expect(result).toContain('AB');
  });

  it('works when no speakerMapping is provided (no dedup)', () => {
    const sp02: Participant = {
      name: 'SPEAKER_02',
      role: 'Student',
      organization: '',
      speaking_segments: ['00:05:00-00:10:00'],
      contact_info: [],
      contributions: ['Led Q&A'],
    };
    const sp05: Participant = {
      name: 'SPEAKER_05',
      role: '',
      organization: '',
      speaking_segments: ['00:15:00-00:20:00'],
      contact_info: [],
      contributions: ['Asked about pricing'],
    };
    const extraction: PeopleExtraction = { participants: [sp02, sp05], relationships: [] };

    // No speakerMapping — both should appear separately with original names
    const result = writePeople({ peopleExtraction: extraction });

    expect(result).toContain('SPEAKER_02');
    expect(result).toContain('SPEAKER_05');
  });
});
