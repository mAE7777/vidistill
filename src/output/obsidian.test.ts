import { describe, it, expect } from 'vitest';
import { addYamlFrontmatter, addWikilinks } from './obsidian.js';
import type { ObsidianMetadata } from './obsidian.js';

function makeMetadata(overrides: Partial<ObsidianMetadata> = {}): ObsidianMetadata {
  return {
    title: 'My Video',
    date: '2026-04-20',
    source: 'https://example.com/video',
    duration: 330,
    videoType: 'coding',
    speakers: [],
    ...overrides,
  };
}

describe('addYamlFrontmatter', () => {
  it('prepends --- delimiters', () => {
    const result = addYamlFrontmatter('# Title', makeMetadata());
    expect(result).toMatch(/^---\n/);
    expect(result).toContain('\n---\n');
  });

  it('includes title field double-quoted', () => {
    const result = addYamlFrontmatter('body', makeMetadata({ title: 'My Video' }));
    expect(result).toContain('title: "My Video"');
  });

  it('includes date field', () => {
    const result = addYamlFrontmatter('body', makeMetadata({ date: '2026-04-20' }));
    expect(result).toContain('date: 2026-04-20');
  });

  it('includes source field double-quoted', () => {
    const result = addYamlFrontmatter('body', makeMetadata({ source: 'https://example.com/video' }));
    expect(result).toContain('source: "https://example.com/video"');
  });

  it('formats duration as Xm Ys', () => {
    const result = addYamlFrontmatter('body', makeMetadata({ duration: 330 }));
    expect(result).toContain('duration: "5m 30s"');
  });

  it('formats duration of full minutes', () => {
    const result = addYamlFrontmatter('body', makeMetadata({ duration: 600 }));
    expect(result).toContain('duration: "10m"');
  });

  it('formats duration of seconds only', () => {
    const result = addYamlFrontmatter('body', makeMetadata({ duration: 45 }));
    expect(result).toContain('duration: "45s"');
  });

  it('assigns coding tags for coding type', () => {
    const result = addYamlFrontmatter('body', makeMetadata({ videoType: 'coding' }));
    expect(result).toContain('- coding-tutorial');
    expect(result).toContain('- video');
  });

  it('assigns meeting tags for meeting type', () => {
    const result = addYamlFrontmatter('body', makeMetadata({ videoType: 'meeting' }));
    expect(result).toContain('- meeting');
    expect(result).toContain('- video');
    expect(result).not.toContain('coding-tutorial');
  });

  it('assigns only video tag for other types', () => {
    const result = addYamlFrontmatter('body', makeMetadata({ videoType: 'lecture' }));
    expect(result).toContain('- video');
    expect(result).not.toContain('coding-tutorial');
    expect(result).not.toContain('meeting');
  });

  it('includes speakers when present', () => {
    const result = addYamlFrontmatter('body', makeMetadata({ speakers: ['Alice', 'Bob'] }));
    expect(result).toContain('speakers:');
    expect(result).toContain('"Alice"');
    expect(result).toContain('"Bob"');
  });

  it('omits speakers field when empty', () => {
    const result = addYamlFrontmatter('body', makeMetadata({ speakers: [] }));
    expect(result).not.toContain('speakers:');
  });

  it('escapes double quotes in title', () => {
    const result = addYamlFrontmatter('body', makeMetadata({ title: 'Say "hello"' }));
    expect(result).toContain('title: "Say \\"hello\\""');
  });

  it('escapes colons in source', () => {
    const result = addYamlFrontmatter('body', makeMetadata({ source: 'path/to: file' }));
    expect(result).toContain('source: "path/to: file"');
  });

  it('preserves original content after frontmatter', () => {
    const result = addYamlFrontmatter('# Guide\n\nSome content', makeMetadata());
    expect(result).toContain('# Guide\n\nSome content');
  });

  it('content starts immediately after closing ---', () => {
    const result = addYamlFrontmatter('# Body', makeMetadata());
    expect(result).toMatch(/---\n# Body/);
  });
});

describe('addWikilinks', () => {
  it('replaces .md link with wikilink (extension stripped)', () => {
    const result = addWikilinks('[Transcript](transcript.md)', ['transcript.md']);
    expect(result).toBe('[[transcript]]');
  });

  it('replaces non-.md file link with wikilink (extension kept)', () => {
    const result = addWikilinks('[Index](code/index.ts)', ['code/index.ts']);
    expect(result).toBe('[[code/index.ts]]');
  });

  it('leaves external http URLs unchanged', () => {
    const input = '[Click here](https://example.com)';
    const result = addWikilinks(input, ['https://example.com']);
    expect(result).toBe(input);
  });

  it('leaves external https URLs unchanged even if in filesGenerated', () => {
    const input = '[Link](https://youtube.com/watch?v=abc)';
    const result = addWikilinks(input, ['https://youtube.com/watch?v=abc']);
    expect(result).toBe(input);
  });

  it('does not replace links not in filesGenerated', () => {
    const input = '[Notes](notes.md)';
    const result = addWikilinks(input, ['transcript.md']);
    expect(result).toBe(input);
  });

  it('replaces multiple links in the same content', () => {
    const input = '[Transcript](transcript.md) and [Notes](notes.md)';
    const result = addWikilinks(input, ['transcript.md', 'notes.md']);
    expect(result).toBe('[[transcript]] and [[notes]]');
  });

  it('handles empty filesGenerated — returns content unchanged', () => {
    const input = '[Transcript](transcript.md)';
    const result = addWikilinks(input, []);
    expect(result).toBe(input);
  });

  it('replaces link with different display text', () => {
    const result = addWikilinks('[View full transcript](transcript.md)', ['transcript.md']);
    expect(result).toBe('[[transcript]]');
  });

  it('only touches matching files, leaves others intact', () => {
    const input = '[A](notes.md) and [B](external.md)';
    const result = addWikilinks(input, ['notes.md']);
    expect(result).toBe('[[notes]] and [B](external.md)');
  });
});
