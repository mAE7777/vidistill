import { type MediaResolution } from '@google/genai';
import type { GeminiClient } from '../gemini/client.js';
import { SYSTEM_INSTRUCTION_PASS_3C, withLanguage } from '../constants/prompts.js';
import { SCHEMA_PASS_3C } from '../gemini/schemas.js';
import { formatTime } from '../lib/utils.js';
import type { Segment, Pass2Result, ChatExtraction } from '../types/index.js';

export interface RunChatExtractionParams {
  client: GeminiClient;
  fileUri: string;
  mimeType: string;
  segment: Segment;
  model: string;
  resolution?: MediaResolution;
  pass2Result?: Pass2Result | null;
  lang?: string;
}

export async function runChatExtraction(params: RunChatExtractionParams): Promise<ChatExtraction> {
  const { client, fileUri, mimeType, segment, model, resolution, pass2Result, lang } = params;

  const visualNotesText =
    pass2Result != null && (pass2Result.visual_notes?.length ?? 0) > 0
      ? pass2Result.visual_notes
          .map((n) => `[${n.timestamp}] ${n.visual_type}: ${n.description}`)
          .join('\n')
      : '[No visual context available for this segment]';

  const codeBlocksText =
    pass2Result != null && (pass2Result.code_blocks?.length ?? 0) > 0
      ? pass2Result.code_blocks
          .map((b) => `[${b.timestamp}] ${b.filename} (${b.language}):\n${b.content}`)
          .join('\n\n')
      : '[No code blocks available for this segment]';

  const contextText = [
    'VISUAL NOTES FROM THIS SEGMENT:',
    visualNotesText,
    '',
    'CODE BLOCKS FROM THIS SEGMENT:',
    codeBlocksText,
  ].join('\n');

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
          text: `Process segment #${segment.index + 1}. Analyze from ${formatTime(segment.startTime)} to ${formatTime(segment.endTime)}.\n\n${contextText}`,
        },
      ],
    },
  ];

  const result = await client.generate({
    model,
    contents,
    config: {
      systemInstruction: withLanguage(SYSTEM_INSTRUCTION_PASS_3C, lang),
      responseSchema: SCHEMA_PASS_3C,
      responseMimeType: 'application/json',
      ...(resolution !== undefined ? { mediaResolution: resolution } : {}),
      maxOutputTokens: 65536,
      temperature: 0.0,
    },
  });

  if (
    result === null ||
    typeof result !== 'object' ||
    !Array.isArray((result as Record<string, unknown>)['messages']) ||
    !Array.isArray((result as Record<string, unknown>)['links'])
  ) {
    throw new Error('Incomplete ChatExtraction from Gemini Pass 3c');
  }

  return result as ChatExtraction;
}
