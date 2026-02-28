import { type MediaResolution } from '@google/genai';
import type { GeminiClient } from '../gemini/client.js';
import { SYSTEM_INSTRUCTION_PASS_3A } from '../constants/prompts.js';
import { SCHEMA_PASS_3A } from '../gemini/schemas.js';
import { formatTime } from '../lib/utils.js';
import type { Segment, Pass1Result, Pass2Result, CodeReconstruction } from '../types/index.js';

export interface RunCodeReconstructionParams {
  client: GeminiClient;
  fileUri: string;
  mimeType: string;
  segment: Segment;
  model: string;
  resolution?: MediaResolution;
  pass1Result?: Pass1Result | null;
  pass2Result?: Pass2Result | null;
}

export async function runCodeReconstruction(params: RunCodeReconstructionParams): Promise<CodeReconstruction> {
  const { client, fileUri, mimeType, segment, model, resolution, pass1Result, pass2Result } = params;

  const transcriptText =
    pass1Result != null
      ? pass1Result.transcript_entries
          .map((t) => `[${t.timestamp}] ${t.speaker}: ${t.text}`)
          .join('\n')
      : '[No transcript available for this segment]';

  const codeBlocksText =
    pass2Result != null && pass2Result.code_blocks.length > 0
      ? pass2Result.code_blocks
          .map((b) => `[${b.timestamp}] ${b.filename} (${b.language}):\n${b.content}`)
          .join('\n\n')
      : '[No code blocks available for this segment]';

  const contextText = [
    'TRANSCRIPT FROM THIS SEGMENT:',
    transcriptText,
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
      systemInstruction: SYSTEM_INSTRUCTION_PASS_3A,
      responseSchema: SCHEMA_PASS_3A,
      responseMimeType: 'application/json',
      ...(resolution !== undefined ? { mediaResolution: resolution } : {}),
      maxOutputTokens: 65536,
      temperature: 1.0,
    },
  });

  if (
    result === null ||
    typeof result !== 'object' ||
    !Array.isArray((result as Record<string, unknown>)['files']) ||
    !Array.isArray((result as Record<string, unknown>)['dependencies_mentioned']) ||
    !Array.isArray((result as Record<string, unknown>)['build_commands'])
  ) {
    throw new Error('Incomplete CodeReconstruction from Gemini Pass 3a');
  }

  return result as CodeReconstruction;
}
