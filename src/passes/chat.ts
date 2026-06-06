import { type MediaResolution } from '@google/genai';
import type { GeminiClient } from '../gemini/client.js';
import { SYSTEM_INSTRUCTION_PASS_3C, withLanguage } from '../constants/prompts.js';
import { SCHEMA_PASS_3C } from '../gemini/schemas.js';
import { formatTime } from '../lib/utils.js';
import type { Segment, Pass2Result, ChatExtraction } from '../types/index.js';
import { isChatRegionType } from '../core/visual-signals.js';

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
  const visualRegions = pass2Result?.visual_regions ?? [];

  const visualNotesText =
    pass2Result != null && (pass2Result.visual_notes?.length ?? 0) > 0
      ? pass2Result.visual_notes
          .map((n) => `[${n.timestamp}] ${n.visual_type}: ${n.description}`)
          .join('\n')
      : '[No visual context available for this segment]';

  const visualRegionsText =
    visualRegions.length > 0
      ? visualRegions
          .map((r) => {
            const bbox =
              r.bbox != null
                ? ` bbox=(${r.bbox.x},${r.bbox.y},${r.bbox.width},${r.bbox.height})`
                : '';
            const focus = isChatRegionType(r.region_type) ? ' FOCUS_CHAT_REGION' : '';
            return `[${r.timestamp}] ${r.region_type}: ${r.label}${bbox} visible=${r.visible} confidence=${r.confidence}${focus}\nsample: ${r.sample_text}`;
          })
          .join('\n')
      : '[No detected visual regions available for this segment]';

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
    'DETECTED VISUAL REGIONS FROM THIS SEGMENT:',
    visualRegionsText,
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
      temperature: 1.0,
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
