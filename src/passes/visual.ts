import { type MediaResolution } from '@google/genai';
import type { GeminiClient } from '../gemini/client.js';
import { SYSTEM_INSTRUCTION_PASS_2_TEMPLATE } from '../constants/prompts.js';
import { SCHEMA_PASS_2 } from '../gemini/schemas.js';
import { formatTime } from '../lib/utils.js';
import type { Segment, Pass1Result, Pass2Result } from '../types/index.js';

export interface RunVisualParams {
  client: GeminiClient;
  fileUri: string;
  mimeType: string;
  segment: Segment;
  model: string;
  resolution?: MediaResolution;
  pass1Transcript?: Pass1Result;
}

export async function runVisual(params: RunVisualParams): Promise<Pass2Result> {
  const { client, fileUri, mimeType, segment, model, resolution, pass1Transcript } = params;

  const transcriptText =
    pass1Transcript != null
      ? pass1Transcript.transcript_entries
          .map((t) => `[${t.timestamp}] ${t.speaker}: ${t.text}`)
          .join('\n')
      : '[No transcript available for this segment]';

  const systemInstruction = SYSTEM_INSTRUCTION_PASS_2_TEMPLATE.replace(
    '{INJECT_PASS1_TRANSCRIPT_HERE}',
    transcriptText,
  );

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
      systemInstruction,
      responseSchema: SCHEMA_PASS_2,
      responseMimeType: 'application/json',
      ...(resolution !== undefined ? { mediaResolution: resolution } : {}),
      maxOutputTokens: 65536,
      temperature: 0.0,
    },
  });

  if (
    result === null ||
    typeof result !== 'object' ||
    !Array.isArray((result as Record<string, unknown>)['code_blocks'])
  ) {
    throw new Error('Empty response from Gemini Pass 2');
  }

  return result as Pass2Result;
}
