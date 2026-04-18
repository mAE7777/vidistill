import { MediaResolution } from '@google/genai';
import type { GeminiClient } from '../gemini/client.js';
import { SYSTEM_INSTRUCTION_PASS_0, withLanguage } from '../constants/prompts.js';
import { SCHEMA_PASS_0 } from '../gemini/schemas.js';
import type { VideoProfile } from '../types/index.js';

export interface RunSceneAnalysisParams {
  client: GeminiClient;
  fileUri: string;
  mimeType: string;
  duration: number;
  model: string;
  resolution?: MediaResolution;
  lang?: string;
}

export async function runSceneAnalysis(params: RunSceneAnalysisParams): Promise<VideoProfile> {
  const { client, fileUri, mimeType, duration, model, resolution, lang } = params;

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const endSeconds = Math.min(180, safeDuration);

  const contents = [
    {
      role: 'user' as const,
      parts: [
        {
          fileData: { fileUri, mimeType },
          videoMetadata: {
            startOffset: '0s',
            endOffset: `${endSeconds}s`,
          },
        },
        {
          text: 'Classify this video and produce a VideoProfile. Analyze the visual content, screen layout, and audio to determine the video type and what passes should be run.',
        },
      ],
    },
  ];

  const result = await client.generate({
    model,
    contents,
    config: {
      systemInstruction: withLanguage(SYSTEM_INSTRUCTION_PASS_0, lang),
      responseSchema: SCHEMA_PASS_0,
      responseMimeType: 'application/json',
      ...(resolution !== undefined ? { mediaResolution: resolution } : { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW }),
      maxOutputTokens: 8192,
      temperature: 1.0,
    },
  });

  if (
    result === null ||
    typeof result !== 'object' ||
    typeof (result as Record<string, unknown>)['type'] !== 'string'
  ) {
    throw new Error('Empty response from Gemini Pass 0');
  }

  const obj = result as Record<string, unknown>;
  if (
    typeof obj['visualContent'] !== 'object' || obj['visualContent'] === null ||
    typeof obj['audioContent'] !== 'object' || obj['audioContent'] === null ||
    typeof obj['recommendations'] !== 'object' || obj['recommendations'] === null
  ) {
    throw new Error('Incomplete VideoProfile from Gemini Pass 0');
  }

  return result as VideoProfile;
}
