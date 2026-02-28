import { describe, it, expect } from 'vitest';
import { isValidYouTubeUrl, extractVideoId, normalizeYouTubeUrl } from './youtube.js';

describe('Phase 4 Gate 2: YouTube URL validation', () => {
  it('1. standard watch URL is valid', () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    expect(isValidYouTubeUrl(url)).toBe(true);
    expect(extractVideoId(url)).toBe('dQw4w9WgXcQ');
  });

  it('2. youtu.be short URL is valid', () => {
    const url = 'https://youtu.be/dQw4w9WgXcQ';
    expect(isValidYouTubeUrl(url)).toBe(true);
    expect(extractVideoId(url)).toBe('dQw4w9WgXcQ');
  });

  it('3. embed URL is valid', () => {
    const url = 'https://www.youtube.com/embed/dQw4w9WgXcQ';
    expect(isValidYouTubeUrl(url)).toBe(true);
    expect(extractVideoId(url)).toBe('dQw4w9WgXcQ');
  });

  it('4. no www is valid', () => {
    const url = 'https://youtube.com/watch?v=dQw4w9WgXcQ';
    expect(isValidYouTubeUrl(url)).toBe(true);
    expect(extractVideoId(url)).toBe('dQw4w9WgXcQ');
  });

  it('5. extra query params are ignored', () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120';
    expect(isValidYouTubeUrl(url)).toBe(true);
    expect(extractVideoId(url)).toBe('dQw4w9WgXcQ');
  });

  it('6. mobile URL is valid', () => {
    const url = 'https://m.youtube.com/watch?v=dQw4w9WgXcQ';
    expect(isValidYouTubeUrl(url)).toBe(true);
    expect(extractVideoId(url)).toBe('dQw4w9WgXcQ');
  });

  it('7. shorts URL is valid', () => {
    const url = 'https://www.youtube.com/shorts/dQw4w9WgXcQ';
    expect(isValidYouTubeUrl(url)).toBe(true);
    expect(extractVideoId(url)).toBe('dQw4w9WgXcQ');
  });

  it('8. wrong domain is invalid', () => {
    expect(isValidYouTubeUrl('https://example.com/watch?v=abc')).toBe(false);
    expect(extractVideoId('https://example.com/watch?v=abc')).toBeNull();
  });

  it('9. non-URL string is invalid', () => {
    expect(isValidYouTubeUrl('not-a-url')).toBe(false);
    expect(extractVideoId('not-a-url')).toBeNull();
  });

  it('10. empty string is invalid', () => {
    expect(isValidYouTubeUrl('')).toBe(false);
    expect(extractVideoId('')).toBeNull();
  });

  it('11. watch URL without video ID is invalid', () => {
    expect(isValidYouTubeUrl('https://www.youtube.com/watch')).toBe(false);
    expect(extractVideoId('https://www.youtube.com/watch')).toBeNull();
  });

  it('12. watch URL with empty ID is invalid', () => {
    expect(isValidYouTubeUrl('https://www.youtube.com/watch?v=')).toBe(false);
    expect(extractVideoId('https://www.youtube.com/watch?v=')).toBeNull();
  });

  it('13. playlist URL is invalid', () => {
    expect(isValidYouTubeUrl('https://www.youtube.com/playlist?list=PLxyz')).toBe(false);
    expect(extractVideoId('https://www.youtube.com/playlist?list=PLxyz')).toBeNull();
  });

  it('normalizeYouTubeUrl returns canonical form', () => {
    expect(normalizeYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'))
      .toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(normalizeYouTubeUrl('invalid')).toBeNull();
  });
});
