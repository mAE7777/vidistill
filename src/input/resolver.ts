import { existsSync } from 'fs';
import { isValidYouTubeUrl, normalizeYouTubeUrl } from './youtube.js';

export interface ResolvedInput {
  type: 'youtube' | 'local' | 'remote';
  value: string;
}

export function resolveInput(input: string): ResolvedInput {
  input = input.trim();

  // Check if it looks like a URL (has a scheme or www)
  const looksLikeUrl = /^https?:\/\/|^www\./i.test(input);

  if (looksLikeUrl) {
    if (!isValidYouTubeUrl(input)) {
      return { type: 'remote', value: input };
    }
    const normalized = normalizeYouTubeUrl(input);
    if (!normalized) {
      return { type: 'remote', value: input };
    }
    return { type: 'youtube', value: normalized };
  }

  // Treat as local file path
  if (!existsSync(input)) {
    throw new Error(`File not found: ${input}`);
  }

  return { type: 'local', value: input };
}
