import { describe, it, expect } from 'vitest';
import { writeChat } from './chat.js';
import type { SegmentResult, ChatExtraction } from '../types/index.js';

function makeSegment(index: number, pass3c: ChatExtraction | null = null): SegmentResult {
  return { index, pass1: null, pass2: null, pass3c };
}

const CHAT_DATA: ChatExtraction = {
  messages: [
    { timestamp: '00:05:00', sender: 'Alice', text: 'Can everyone hear me?' },
    { timestamp: '00:05:15', sender: 'Bob', text: 'Yes, loud and clear!' },
  ],
  links: [
    { url: 'https://github.com/org/repo', context: 'The main repo', timestamp: '00:10:00' },
  ],
};

const CHAT_DATA_2: ChatExtraction = {
  messages: [
    { timestamp: '00:20:00', sender: 'Carol', text: 'Here is the doc link' },
  ],
  links: [
    { url: 'https://docs.example.com', context: 'Design doc', timestamp: '00:20:05' },
    // duplicate of CHAT_DATA link
    { url: 'https://github.com/org/repo', context: 'Same repo again', timestamp: '00:20:10' },
  ],
};

describe('writeChat', () => {
  it('returns null when no segments have pass3c data', () => {
    const segments = [makeSegment(0), makeSegment(1)];
    expect(writeChat({ segments })).toBeNull();
  });

  it('returns null when segments array is empty', () => {
    expect(writeChat({ segments: [] })).toBeNull();
  });

  it('returns null when pass3c has empty messages and links', () => {
    const seg = makeSegment(0, { messages: [], links: [] });
    expect(writeChat({ segments: [seg] })).toBeNull();
  });

  it('contains heading when chat data is present', () => {
    const seg = makeSegment(0, CHAT_DATA);
    const result = writeChat({ segments: [seg] });
    expect(result).toContain('# Chat');
  });

  it('includes all messages', () => {
    const seg = makeSegment(0, CHAT_DATA);
    const result = writeChat({ segments: [seg] });
    expect(result).toContain('Alice');
    expect(result).toContain('Can everyone hear me?');
    expect(result).toContain('Bob');
    expect(result).toContain('Yes, loud and clear!');
  });

  it('includes timestamps for messages', () => {
    const seg = makeSegment(0, CHAT_DATA);
    const result = writeChat({ segments: [seg] });
    expect(result).toContain('00:05:00');
    expect(result).toContain('00:05:15');
  });

  it('includes links', () => {
    const seg = makeSegment(0, CHAT_DATA);
    const result = writeChat({ segments: [seg] });
    expect(result).toContain('https://github.com/org/repo');
    expect(result).toContain('The main repo');
  });

  it('aggregates messages and links from multiple segments', () => {
    const seg0 = makeSegment(0, CHAT_DATA);
    const seg1 = makeSegment(1, CHAT_DATA_2);
    const result = writeChat({ segments: [seg0, seg1] });
    expect(result).toContain('Alice');
    expect(result).toContain('Carol');
    expect(result).toContain('Here is the doc link');
  });

  it('deduplicates links by URL across segments', () => {
    const seg0 = makeSegment(0, CHAT_DATA);
    const seg1 = makeSegment(1, CHAT_DATA_2);
    const result = writeChat({ segments: [seg0, seg1] });
    // github.com/org/repo appears in both CHAT_DATA and CHAT_DATA_2, should only appear once
    const matches = (result ?? '').match(/https:\/\/github\.com\/org\/repo/g);
    expect(matches).toHaveLength(1);
  });

  it('skips segments without pass3c', () => {
    const seg0 = makeSegment(0);
    const seg1 = makeSegment(1, CHAT_DATA);
    const result = writeChat({ segments: [seg0, seg1] });
    expect(result).toContain('Alice');
  });

  it('returns a string', () => {
    const seg = makeSegment(0, CHAT_DATA);
    const result = writeChat({ segments: [seg] });
    expect(typeof result).toBe('string');
  });
});
