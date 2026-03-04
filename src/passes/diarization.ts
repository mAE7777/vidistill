import { type MediaResolution } from '@google/genai';
import type { GeminiClient } from '../gemini/client.js';
import { SYSTEM_INSTRUCTION_PASS_1B, withLanguage } from '../constants/prompts.js';
import { SCHEMA_PASS_1B } from '../gemini/schemas.js';
import { formatTime } from '../lib/utils.js';
import type { Segment, Pass1aResult, Pass1bResult } from '../types/index.js';

export interface RunDiarizationParams {
  client: GeminiClient;
  fileUri: string;
  mimeType: string;
  segment: Segment;
  model: string;
  resolution?: MediaResolution;
  lang?: string;
  pass1aResult: Pass1aResult;
}

function formatTranscriptForInjection(pass1a: Pass1aResult): string {
  if (pass1a.transcript_entries.length === 0) {
    return '[No transcript entries in this segment]';
  }
  return pass1a.transcript_entries
    .map((e) => `[${e.timestamp}] ${e.text}`)
    .join('\n');
}

export async function runDiarization(params: RunDiarizationParams): Promise<Pass1bResult> {
  const { client, fileUri, mimeType, segment, model, resolution, lang, pass1aResult } = params;

  const transcriptText = formatTranscriptForInjection(pass1aResult);
  const systemInstruction = withLanguage(
    SYSTEM_INSTRUCTION_PASS_1B.replace('{INJECT_PASS1A_TRANSCRIPT_HERE}', transcriptText),
    lang,
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
          text: `Process segment #${segment.index + 1}. Identify speakers from ${formatTime(segment.startTime)} to ${formatTime(segment.endTime)}.`,
        },
      ],
    },
  ];

  const result = await client.generate({
    model,
    contents,
    config: {
      systemInstruction,
      responseSchema: SCHEMA_PASS_1B,
      responseMimeType: 'application/json',
      ...(resolution !== undefined ? { mediaResolution: resolution } : {}),
      maxOutputTokens: 65536,
      temperature: 1.0,
    },
  });

  if (
    result === null ||
    typeof result !== 'object' ||
    !Array.isArray((result as Record<string, unknown>)['speaker_assignments'])
  ) {
    throw new Error('Empty response from Gemini Pass 1b');
  }

  return result as Pass1bResult;
}
