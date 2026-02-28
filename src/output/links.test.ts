import { describe, it, expect } from 'vitest';
import { writeLinks } from './links.js';
import type { SegmentResult, ChatExtraction } from '../types/index.js';

function makeSegment(index: number, pass3c: ChatExtraction | null = null): SegmentResult {
  return { index, pass1: null, pass2: null, pass3c };
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
});
