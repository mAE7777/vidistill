import { type MediaResolution } from '@google/genai';
import type { GeminiClient } from '../gemini/client.js';
import { SYSTEM_INSTRUCTION_PASS_1, withLanguage } from '../constants/prompts.js';
import { SCHEMA_PASS_1 } from '../gemini/schemas.js';
import { formatTime } from '../lib/utils.js';
import type { Segment, Pass1Result } from '../types/index.js';

export interface RunTranscriptParams {
  client: GeminiClient;
  fileUri: string;
  mimeType: string;
  segment: Segment;
  model: string;
  resolution?: MediaResolution;
  lang?: string;
}

export async function runTranscript(params: RunTranscriptParams): Promise<Pass1Result> {
  const { client, fileUri, mimeType, segment, model, resolution, lang } = params;

  const contents = [
    {
      role: 'user' as const,
      parts: [
        {
          fileData: { fileUri, mimeType },
          videoMetadata: {
            startOffset: `${segment.startTime}s`,
            endOffset: `${segment.endTime}s`,
          },
        },
        {
          text: `Process segment #${segment.index + 1}. Analyze from ${formatTime(segment.startTime)} to ${formatTime(segment.endTime)}.`,
        },
      ],
    },
  ];

  const result = await client.generate({
    model,
    contents,
    config: {
      systemInstruction: withLanguage(SYSTEM_INSTRUCTION_PASS_1, lang),
      responseSchema: SCHEMA_PASS_1,
      responseMimeType: 'application/json',
      ...(resolution !== undefined ? { mediaResolution: resolution } : {}),
      maxOutputTokens: 65536,
      temperature: 1.0,
    },
  });

  if (
    result === null ||
    typeof result !== 'object' ||
    !Array.isArray((result as Record<string, unknown>)['transcript_entries'])
  ) {
    throw new Error('Empty response from Gemini Pass 1');
  }

  return result as Pass1Result;
}
