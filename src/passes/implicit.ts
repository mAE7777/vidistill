import { type MediaResolution } from '@google/genai';
import type { GeminiClient } from '../gemini/client.js';
import { SYSTEM_INSTRUCTION_PASS_3D, withLanguage } from '../constants/prompts.js';
import { SCHEMA_PASS_3D } from '../gemini/schemas.js';
import { formatTime } from '../lib/utils.js';
import type { Segment, Pass1Result, Pass2Result, ImplicitSignals } from '../types/index.js';

export interface RunImplicitSignalsParams {
  client: GeminiClient;
  fileUri: string;
  mimeType: string;
  segment: Segment;
  model: string;
  resolution?: MediaResolution;
  pass1Result?: Pass1Result | null;
  pass2Result?: Pass2Result | null;
  lang?: string;
}

export async function runImplicitSignals(params: RunImplicitSignalsParams): Promise<ImplicitSignals> {
  const { client, fileUri, mimeType, segment, model, resolution, pass1Result, pass2Result, lang } = params;

  const transcriptText =
    pass1Result != null
      ? pass1Result.transcript_entries
          .map((t) => `[${t.timestamp}] ${t.speaker} (${t.tone}): ${t.text}`)
          .join('\n')
      : '[No transcript available for this segment]';

  const visualNotesText =
    pass2Result != null && (pass2Result.visual_notes?.length ?? 0) > 0
      ? pass2Result.visual_notes
          .map((n) => `[${n.timestamp}] ${n.visual_type}: ${n.description}`)
          .join('\n')
      : '[No visual context available for this segment]';

  const contextText = [
    'TRANSCRIPT FROM THIS SEGMENT:',
    transcriptText,
    '',
    'VISUAL NOTES FROM THIS SEGMENT:',
    visualNotesText,
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
      systemInstruction: withLanguage(SYSTEM_INSTRUCTION_PASS_3D, lang),
      responseSchema: SCHEMA_PASS_3D,
      responseMimeType: 'application/json',
      ...(resolution !== undefined ? { mediaResolution: resolution } : {}),
      maxOutputTokens: 65536,
      temperature: 0.1,
    },
  });

  if (
    result === null ||
    typeof result !== 'object' ||
    !Array.isArray((result as Record<string, unknown>)['emotional_shifts']) ||
    !Array.isArray((result as Record<string, unknown>)['questions_implicit']) ||
    !Array.isArray((result as Record<string, unknown>)['decisions_implicit']) ||
    !Array.isArray((result as Record<string, unknown>)['tasks_assigned']) ||
    !Array.isArray((result as Record<string, unknown>)['emphasis_patterns'])
  ) {
    throw new Error('Incomplete ImplicitSignals from Gemini Pass 3d');
  }

  return result as ImplicitSignals;
}
