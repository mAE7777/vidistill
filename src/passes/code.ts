import { type MediaResolution } from '@google/genai';
import type { GeminiClient } from '../gemini/client.js';
import { SYSTEM_INSTRUCTION_PASS_3A, withLanguage } from '../constants/prompts.js';
import { SCHEMA_PASS_3A } from '../gemini/schemas.js';
import { formatTime } from '../lib/utils.js';
import type { Pass1Result, Pass2Result, CodeReconstruction } from '../types/index.js';

export interface RunCodeReconstructionParams {
  client: GeminiClient;
  fileUri: string;
  mimeType: string;
  duration: number;
  model: string;
  resolution?: MediaResolution;
  pass1Results: (Pass1Result | null)[];
  pass2Results: (Pass2Result | null)[];
  lang?: string;
}

const MAX_CONTEXT_CHARS = 200_000;
const LONG_VIDEO_THRESHOLD_SECONDS = 3600;

export function compileContext(
  duration: number,
  pass1Results: (Pass1Result | null)[],
  pass2Results: (Pass2Result | null)[],
): string {
  const isLongVideo = duration > LONG_VIDEO_THRESHOLD_SECONDS;

  // For long videos, only include transcript for segments that have code blocks
  const segmentIndicesToInclude = isLongVideo
    ? new Set(
        pass2Results
          .map((r, i) => (r != null && r.code_blocks.length > 0 ? i : -1))
          .filter((i) => i !== -1),
      )
    : null;

  // Build transcript section
  const transcriptLines: string[] = ['TRANSCRIPT (all segments):'];
  for (let i = 0; i < pass1Results.length; i++) {
    const p1 = pass1Results[i] ?? null;
    const p2 = pass2Results[i] ?? null;

    // For long videos, skip segments with no code blocks
    if (isLongVideo && segmentIndicesToInclude !== null && !segmentIndicesToInclude.has(i)) {
      continue;
    }

    // Build the segment header from time_range if available, else use index fallback
    let header: string;
    if (p1 != null && p1.time_range) {
      header = `=== Segment ${i + 1} (${p1.time_range}) ===`;
    } else if (p2 != null && p2.time_range) {
      header = `=== Segment ${i + 1} (${p2.time_range}) ===`;
    } else {
      header = `=== Segment ${i + 1} ===`;
    }

    transcriptLines.push(header);

    if (p1 != null) {
      for (const entry of p1.transcript_entries) {
        transcriptLines.push(`[${entry.timestamp}] ${entry.speaker}: ${entry.text}`);
      }
    } else {
      transcriptLines.push('[No transcript available]');
    }
  }

  // Build code blocks section
  const codeLines: string[] = ['CODE BLOCKS EXTRACTED (all segments):'];
  for (let i = 0; i < pass2Results.length; i++) {
    const p2 = pass2Results[i] ?? null;
    if (p2 == null || p2.code_blocks.length === 0) continue;

    const p1 = pass1Results[i] ?? null;
    let header: string;
    if (p2.time_range) {
      header = `=== Segment ${i + 1} (${p2.time_range}) ===`;
    } else if (p1 != null && p1.time_range) {
      header = `=== Segment ${i + 1} (${p1.time_range}) ===`;
    } else {
      header = `=== Segment ${i + 1} ===`;
    }

    codeLines.push(header);
    for (const block of p2.code_blocks) {
      codeLines.push(`[${block.timestamp}] ${block.language}:\n${block.content}`);
    }
  }

  let contextText = [transcriptLines.join('\n'), '', codeLines.join('\n')].join('\n');

  // Cap total text at 200k characters for long videos, truncating at a newline boundary
  if (isLongVideo && contextText.length > MAX_CONTEXT_CHARS) {
    const lastNewline = contextText.lastIndexOf('\n', MAX_CONTEXT_CHARS);
    contextText = contextText.slice(0, lastNewline > 0 ? lastNewline : MAX_CONTEXT_CHARS);
  }

  return contextText;
}

export async function runCodeReconstruction(params: RunCodeReconstructionParams): Promise<CodeReconstruction> {
  const { client, fileUri, mimeType, duration, model, resolution, pass1Results, pass2Results, lang } = params;

  const contextText = compileContext(duration, pass1Results, pass2Results);

  const contents = [
    {
      role: 'user' as const,
      parts: [
        { fileData: { fileUri, mimeType } },
        {
          text: `Analyze the entire video (${formatTime(duration)} total).\n\n${contextText}`,
        },
      ],
    },
  ];

  const result = await client.generate({
    model,
    contents,
    config: {
      systemInstruction: withLanguage(SYSTEM_INSTRUCTION_PASS_3A, lang),
      responseSchema: SCHEMA_PASS_3A,
      responseMimeType: 'application/json',
      ...(resolution !== undefined ? { mediaResolution: resolution } : {}),
      maxOutputTokens: 65536,
      temperature: 0.0,
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
