import { existsSync } from 'fs';
import { isValidYouTubeUrl, normalizeYouTubeUrl } from './youtube.js';

export interface ResolvedInput {
  type: 'youtube' | 'local';
  value: string;
}

export function resolveInput(input: string): ResolvedInput {
  input = input.trim();

  // Check if it looks like a URL (has a scheme or www)
  const looksLikeUrl = /^https?:\/\/|^www\./i.test(input);

  if (looksLikeUrl) {
    if (!isValidYouTubeUrl(input)) {
      throw new Error('Invalid URL. Only YouTube URLs are supported.');
    }
    const normalized = normalizeYouTubeUrl(input);
    if (!normalized) {
      throw new Error('Invalid URL. Only YouTube URLs are supported.');
    }
    return { type: 'youtube', value: normalized };
  }

  // Treat as local file path
  if (!existsSync(input)) {
    throw new Error(`File not found: ${input}`);
  }

  return { type: 'local', value: input };
}
