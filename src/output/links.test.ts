import { describe, it, expect } from 'vitest';
import { writeLinks, scanChatMessagesForUrls, scanTranscriptForUrls } from './links.js';
import type { SegmentResult, ChatExtraction, Pass1Result } from '../types/index.js';

function makeSegment(index: number, pass3c: ChatExtraction | null = null, pass1: Pass1Result | null = null): SegmentResult {
  return { index, pass1, pass2: null, pass3c };
}

function makePass1(entries: Array<{ timestamp: string; text: string }>): Pass1Result {
  return {
    segment_index: 0,
    time_range: '0:00-1:00',
    transcript_entries: entries.map((e) => ({ timestamp: e.timestamp, speaker: 'SPEAKER_00', text: e.text, tone: 'neutral' })),
    speaker_summary: [],
  };
}

const LINKS_CHAT: ChatExtraction = {
  messages: [],
  links: [
    { url: 'https://github.com/org/project', context: 'Source code', timestamp: '00:05:00' },
    { url: 'https://npmjs.com/package/vidistill', context: 'NPM package', timestamp: '00:06:00' },
    { url: 'https://docs.example.com/guide', context: 'API guide', timestamp: '00:07:00' },
    { url: 'https://youtube.com/watch?v=abc', context: 'Demo video', timestamp: '00:08:00' },
    { url: 'https://medium.com/@author/post', context: 'Blog post', timestamp: '00:09:00' },
    { url: 'https://random-site.example', context: 'Random link', timestamp: '00:10:00' },
  ],
};

const DUPLICATE_LINKS_CHAT: ChatExtraction = {
  messages: [],
  links: [
    { url: 'https://github.com/org/project', context: 'duplicate', timestamp: '00:15:00' },
    { url: 'https://stackoverflow.com/q/123', context: 'SO answer', timestamp: '00:16:00' },
  ],
};

describe('writeLinks', () => {
  it('returns null when no segments have links', () => {
    const seg = makeSegment(0, { messages: [], links: [] });
    expect(writeLinks({ segments: [seg] })).toBeNull();
  });

  it('returns null when no segments have pass3c', () => {
    const seg = makeSegment(0);
    expect(writeLinks({ segments: [seg] })).toBeNull();
  });

  it('returns null when segments array is empty', () => {
    expect(writeLinks({ segments: [] })).toBeNull();
  });

  it('contains heading when links exist', () => {
    const seg = makeSegment(0, LINKS_CHAT);
    const result = writeLinks({ segments: [seg] });
    expect(result).toContain('# Links');
  });

  it('categorizes GitHub URLs correctly', () => {
    const seg = makeSegment(0, LINKS_CHAT);
    const result = writeLinks({ segments: [seg] });
    expect(result).toContain('## GitHub');
    expect(result).toContain('https://github.com/org/project');
  });

  it('categorizes npm URLs correctly', () => {
    const seg = makeSegment(0, LINKS_CHAT);
    const result = writeLinks({ segments: [seg] });
    expect(result).toContain('## npm');
    expect(result).toContain('https://npmjs.com/package/vidistill');
  });

  it('categorizes documentation URLs correctly', () => {
    const seg = makeSegment(0, LINKS_CHAT);
    const result = writeLinks({ segments: [seg] });
    expect(result).toContain('## Documentation');
    expect(result).toContain('https://docs.example.com/guide');
  });

  it('categorizes YouTube URLs correctly', () => {
    const seg = makeSegment(0, LINKS_CHAT);
    const result = writeLinks({ segments: [seg] });
    expect(result).toContain('## Video');
    expect(result).toContain('https://youtube.com/watch?v=abc');
  });

  it('categorizes Articles URLs correctly', () => {
    const seg = makeSegment(0, LINKS_CHAT);
    const result = writeLinks({ segments: [seg] });
    expect(result).toContain('## Articles');
    expect(result).toContain('https://medium.com/@author/post');
  });

  it('categorizes unknown URLs as Other', () => {
    const seg = makeSegment(0, LINKS_CHAT);
    const result = writeLinks({ segments: [seg] });
    expect(result).toContain('## Other');
    expect(result).toContain('https://random-site.example');
  });

  it('deduplicates URLs across segments', () => {
    const seg0 = makeSegment(0, LINKS_CHAT);
    const seg1 = makeSegment(1, DUPLICATE_LINKS_CHAT);
    const result = writeLinks({ segments: [seg0, seg1] });
    // github.com/org/project appears in both, should only appear once
    const matches = (result ?? '').match(/https:\/\/github\.com\/org\/project/g);
    expect(matches).toHaveLength(1);
  });

  it('includes link context in output', () => {
    const seg = makeSegment(0, LINKS_CHAT);
    const result = writeLinks({ segments: [seg] });
    expect(result).toContain('Source code');
    expect(result).toContain('NPM package');
  });

  it('includes timestamps', () => {
    const seg = makeSegment(0, LINKS_CHAT);
    const result = writeLinks({ segments: [seg] });
    expect(result).toContain('00:05:00');
  });

  it('aggregates links from multiple segments', () => {
    const seg0 = makeSegment(0, LINKS_CHAT);
    const seg1 = makeSegment(1, DUPLICATE_LINKS_CHAT);
    const result = writeLinks({ segments: [seg0, seg1] });
    expect(result).toContain('https://stackoverflow.com/q/123');
  });

  it('returns a string', () => {
    const seg = makeSegment(0, LINKS_CHAT);
    const result = writeLinks({ segments: [seg] });
    expect(typeof result).toBe('string');
  });

  it('extracts URL from transcript when pass3c did not run', () => {
    const pass1 = makePass1([{ timestamp: '00:01:00', text: 'check out https://example.com/docs for details' }]);
    const seg = makeSegment(0, null, pass1);
    const result = writeLinks({ segments: [seg] });
    expect(result).toContain('https://example.com/docs');
  });

  it('strips trailing punctuation from transcript URLs', () => {
    const pass1 = makePass1([{ timestamp: '00:01:00', text: 'visit https://example.com/docs.' }]);
    const seg = makeSegment(0, null, pass1);
    const result = writeLinks({ segments: [seg] });
    expect(result).toContain('https://example.com/docs');
    expect(result).not.toContain('https://example.com/docs.');
  });

  it('deduplicates URL from transcript when pass3c already has it, preserving pass3c context', () => {
    const pass3c: ChatExtraction = {
      messages: [],
      links: [{ url: 'https://github.com/foo', context: 'Source repo', timestamp: '00:02:00' }],
    };
    const pass1 = makePass1([{ timestamp: '00:03:00', text: 'see https://github.com/foo for code' }]);
    const seg = makeSegment(0, pass3c, pass1);
    const result = writeLinks({ segments: [seg] });
    // URL appears only once
    const matches = (result ?? '').match(/https:\/\/github\.com\/foo/g);
    expect(matches).toHaveLength(1);
    // pass3c context preserved
    expect(result).toContain('Source repo');
  });

  it('returns null when no URLs in transcript and no pass3c', () => {
    const pass1 = makePass1([{ timestamp: '00:01:00', text: 'no links here at all' }]);
    const seg = makeSegment(0, null, pass1);
    expect(writeLinks({ segments: [seg] })).toBeNull();
  });

  it('returns null when no pass3c and no pass1', () => {
    const seg = makeSegment(0, null, null);
    expect(writeLinks({ segments: [seg] })).toBeNull();
  });

  it('extracts bare domains from chat messages into links.md', () => {
    const pass3c: ChatExtraction = {
      messages: [
        {
          timestamp: '00:00:15',
          sender: 'Sophia',
          text: 'Learn more here: techstars.com/accelerators/mentorship/members',
        },
      ],
      links: [],
    };
    const seg = makeSegment(0, pass3c);

    const result = writeLinks({ segments: [seg] });

    expect(result).toContain('https://techstars.com/accelerators/mentorship/members');
    expect(result).toContain('Visible chat message from Sophia');
  });

  it('deduplicates explicit pass3c links against bare chat message domains', () => {
    const pass3c: ChatExtraction = {
      messages: [
        { timestamp: '00:00:15', sender: 'Sophia', text: 'techstars.com/accelerators/mentorship/members' },
      ],
      links: [
        {
          timestamp: '00:00:15',
          url: 'https://techstars.com/accelerators/mentorship/members',
          context: 'Confirmed by chat extraction',
        },
      ],
    };
    const seg = makeSegment(0, pass3c);

    const result = writeLinks({ segments: [seg] });
    const matches = (result ?? '').match(/techstars\.com\/accelerators\/mentorship\/members/g);

    expect(matches).toHaveLength(1);
    expect(result).toContain('Confirmed by chat extraction');
  });
});

describe('scanTranscriptForUrls', () => {
  it('returns empty array for segments with no pass1', () => {
    const seg = makeSegment(0);
    expect(scanTranscriptForUrls([seg])).toHaveLength(0);
  });

  it('returns empty array when transcript has no URLs', () => {
    const pass1 = makePass1([{ timestamp: '00:01:00', text: 'hello world, no links' }]);
    const seg = makeSegment(0, null, pass1);
    expect(scanTranscriptForUrls([seg])).toHaveLength(0);
  });

  it('extracts a URL from transcript text', () => {
    const pass1 = makePass1([{ timestamp: '00:01:00', text: 'see https://example.com/docs for details' }]);
    const seg = makeSegment(0, null, pass1);
    const links = scanTranscriptForUrls([seg]);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://example.com/docs');
    expect(links[0].context).toBe('');
    expect(links[0].timestamp).toBe('00:01:00');
  });

  it('extracts a bare domain from transcript text and adds https', () => {
    const pass1 = makePass1([{ timestamp: '00:01:00', text: 'see techstars.com/accelerators/mentorship/members for details' }]);
    const seg = makeSegment(0, null, pass1);
    const links = scanTranscriptForUrls([seg]);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe('https://techstars.com/accelerators/mentorship/members');
  });

  it('does not extract the domain part of an email address as a link', () => {
    const pass1 = makePass1([{ timestamp: '00:01:00', text: 'email me at founder@example.com' }]);
    const seg = makeSegment(0, null, pass1);
    expect(scanTranscriptForUrls([seg])).toHaveLength(0);
  });

  it('does not extract title-case sentence fragments as bare domains', () => {
    const pass1 = makePass1([{ timestamp: '00:01:00', text: 'Fabulous Nutrition-cortex Bars.Gut health to support Brain Health' }]);
    const seg = makeSegment(0, null, pass1);
    expect(scanTranscriptForUrls([seg])).toHaveLength(0);
  });

  it('strips trailing period from URL', () => {
    const pass1 = makePass1([{ timestamp: '00:01:00', text: 'go to https://example.com.' }]);
    const seg = makeSegment(0, null, pass1);
    const links = scanTranscriptForUrls([seg]);
    expect(links[0].url).toBe('https://example.com');
  });

  it('strips trailing comma from URL', () => {
    const pass1 = makePass1([{ timestamp: '00:01:00', text: 'try https://example.com/path, and also' }]);
    const seg = makeSegment(0, null, pass1);
    const links = scanTranscriptForUrls([seg]);
    expect(links[0].url).toBe('https://example.com/path');
  });

  it('extracts multiple URLs from a single entry', () => {
    const pass1 = makePass1([{ timestamp: '00:01:00', text: 'see https://foo.com and https://bar.com' }]);
    const seg = makeSegment(0, null, pass1);
    const links = scanTranscriptForUrls([seg]);
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.url)).toContain('https://foo.com');
    expect(links.map((l) => l.url)).toContain('https://bar.com');
  });
});

describe('scanChatMessagesForUrls', () => {
  it('extracts bare domains from chat messages', () => {
    const seg = makeSegment(0, {
      messages: [
        { timestamp: '00:00:15', sender: 'Sophia', text: 'techstars.com/accelerators/mentorship/members' },
      ],
      links: [],
    });

    const links = scanChatMessagesForUrls([seg]);

    expect(links).toEqual([
      {
        url: 'https://techstars.com/accelerators/mentorship/members',
        context: 'Visible chat message from Sophia',
        timestamp: '00:00:15',
      },
    ]);
  });
});
