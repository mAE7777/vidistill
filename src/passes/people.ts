import type { GeminiClient } from '../gemini/client.js';
import { SYSTEM_INSTRUCTION_PASS_3B, withLanguage } from '../constants/prompts.js';
import { SCHEMA_PASS_3B } from '../gemini/schemas.js';
import type { Pass1Result, PeopleExtraction } from '../types/index.js';

export interface RunPeopleExtractionParams {
  client: GeminiClient;
  fileUri: string;
  mimeType: string;
  model: string;
  pass1Results: (Pass1Result | null)[];
  lang?: string;
}

export async function runPeopleExtraction(params: RunPeopleExtractionParams): Promise<PeopleExtraction> {
  const { client, fileUri, mimeType, model, pass1Results, lang } = params;

  const hasAnyTranscript = pass1Results.some((r) => r != null);

  const transcriptText = hasAnyTranscript
    ? pass1Results
        .filter((r): r is Pass1Result => r != null)
        .flatMap((r) =>
          r.transcript_entries.map((t) => `[${t.timestamp}] ${t.speaker}: ${t.text}`)
        )
        .join('\n')
    : '[No transcript available]';

  const transcriptContext = `TRANSCRIPT FROM ALL SEGMENTS:\n${transcriptText}`;

  const contents = [
    {
      role: 'user' as const,
      parts: [
        { fileData: { fileUri, mimeType } },
        { text: `Analyze the entire video. ${transcriptContext}` },
      ],
    },
  ];

  const result = await client.generate({
    model,
    contents,
    config: {
      systemInstruction: withLanguage(SYSTEM_INSTRUCTION_PASS_3B, lang),
      responseSchema: SCHEMA_PASS_3B,
      responseMimeType: 'application/json',
      maxOutputTokens: 65536,
      temperature: 0.0,
    },
  });

  if (
    result === null ||
    typeof result !== 'object' ||
    !Array.isArray((result as Record<string, unknown>)['participants']) ||
    !Array.isArray((result as Record<string, unknown>)['relationships'])
  ) {
    throw new Error('Incomplete PeopleExtraction from Gemini Pass 3b');
  }

  return result as PeopleExtraction;
}
