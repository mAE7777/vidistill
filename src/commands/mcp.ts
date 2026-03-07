import { resolve, join, basename, extname } from 'path';
import { existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';

import { loadConfig } from '../cli/config.js';
import { GeminiClient } from '../gemini/client.js';
import { RateLimiter } from '../gemini/rate-limiter.js';
import { resolveInput } from '../input/resolver.js';
import { handleYouTube, extractVideoId } from '../input/youtube.js';
import { handleLocalFile } from '../input/local-file.js';
import { detectDuration } from '../input/duration.js';
import { runPipeline } from '../core/pipeline.js';
import { generateOutput, slugify } from '../output/generator.js';
import { readJsonFile, parseTimestamp } from '../lib/utils.js';
import { MODELS } from '../gemini/models.js';
import type { Pass1Result, SynthesisResult } from '../types/index.js';

const DEFAULT_OUTPUT = './vidistill-output/';

/**
 * Resolve API key from env or config file (no interactive prompt).
 */
export async function resolveApiKeyNonInteractive(): Promise<string> {
  const envKey = process.env['GEMINI_API_KEY'];
  if (envKey && envKey.trim().length > 0) return envKey.trim();

  const config = await loadConfig();
  if (config?.apiKey && config.apiKey.trim().length > 0) return config.apiKey.trim();

  throw new Error('GEMINI_API_KEY not set. Set it as an environment variable or in ~/.vidistill/config.json');
}

/**
 * Run the full vidistill pipeline for a given input.
 */
async function analyzeVideo(input: string, context?: string, lang?: string): Promise<{ outputDir: string; summary: string }> {
  const apiKey = await resolveApiKeyNonInteractive();
  const resolved = resolveInput(input);
  const client = new GeminiClient(apiKey);

  let fileUri: string;
  let mimeType: string;
  let duration: number;
  let videoTitle: string;

  if (resolved.type === 'youtube') {
    const result = await handleYouTube(resolved.value, client);
    fileUri = result.fileUri;
    mimeType = result.mimeType;
    try {
      duration = await detectDuration({
        ytDlpDuration: result.duration,
        geminiDuration: result.duration,
      });
    } catch (err) {
      process.stderr.write(`Duration detection failed, using 600s fallback: ${err instanceof Error ? err.message : String(err)}\n`);
      duration = 600;
    }
    const videoId = extractVideoId(resolved.value);
    videoTitle = videoId != null ? `youtube-${videoId}` : resolved.value;
  } else {
    const result = await handleLocalFile(resolved.value, client);
    fileUri = result.fileUri;
    mimeType = result.mimeType;
    duration = await detectDuration({
      filePath: resolved.value,
      geminiDuration: result.duration,
    });
    videoTitle = basename(resolved.value, extname(resolved.value));
  }

  const model = MODELS.flash;
  const outputDir = resolve(DEFAULT_OUTPUT);
  const slug = slugify(videoTitle);
  const finalOutputDir = `${outputDir}/${slug}`;

  const rateLimiter = new RateLimiter();

  const pipelineResult = await runPipeline({
    client,
    fileUri,
    mimeType,
    duration,
    model,
    context,
    lang,
    rateLimiter,
  });

  await generateOutput({
    pipelineResult,
    outputDir,
    videoTitle,
    source: input,
    duration,
    model,
    processingTimeMs: 0,
  });

  // Read synthesis.json for summary
  let summary = 'Analysis complete.';
  const synthesisPath = join(finalOutputDir, 'raw', 'synthesis.json');
  const synthesis = await readJsonFile<SynthesisResult>(synthesisPath);
  if (synthesis?.overview) {
    summary = synthesis.overview;
  }

  return { outputDir: finalOutputDir, summary };
}

/**
 * Read transcript from an existing output directory.
 */
export async function getTranscript(
  outputDir: string,
  startTime?: number,
  endTime?: number,
): Promise<string> {
  const absDir = resolve(outputDir);
  if (!existsSync(absDir)) {
    throw new Error('Not a vidistill output directory');
  }

  const rawDir = join(absDir, 'raw');
  if (!existsSync(rawDir)) {
    throw new Error('No extracted data found');
  }

  const files = await readdir(rawDir);
  const pass1Files = files.filter(f => /^pass1-seg\d+\.json$/.test(f)).sort();

  if (pass1Files.length === 0) {
    throw new Error('No extracted data found');
  }

  const lines: string[] = [];

  for (const file of pass1Files) {
    const data = await readJsonFile<Pass1Result>(join(rawDir, file));
    if (data?.transcript_entries == null) continue;

    for (const entry of data.transcript_entries) {
      if (startTime != null || endTime != null) {
        const ts = parseTimestamp(entry.timestamp);
        if (startTime != null && ts < startTime) continue;
        if (endTime != null && ts > endTime) continue;
      }
      const speaker = entry.speaker ? `${entry.speaker}: ` : '';
      lines.push(`[${entry.timestamp}] ${speaker}${entry.text}`);
    }
  }

  return lines.join('\n');
}

/**
 * Read code files from an existing output directory.
 */
export async function getCode(outputDir: string): Promise<{ filename: string; content: string }[]> {
  const absDir = resolve(outputDir);
  if (!existsSync(absDir)) {
    throw new Error('Not a vidistill output directory');
  }

  const codeDir = join(absDir, 'code');
  if (!existsSync(codeDir)) {
    return [];
  }

  const files = await readdir(codeDir);
  const results: { filename: string; content: string }[] = [];

  for (const file of files) {
    const content = await readFile(join(codeDir, file), 'utf8');
    results.push({ filename: file, content });
  }

  return results;
}

export async function run(_args: string[]): Promise<void> {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const z = await import('zod');

  const server = new McpServer({
    name: 'vidistill',
    version: '1.0.0',
  });

  server.registerTool(
    'analyze_video',
    {
      title: 'Analyze Video',
      description: 'Run the full vidistill pipeline on a video URL or local file. Returns the output directory and a summary.',
      inputSchema: z.object({
        input: z.string().describe('YouTube URL or local file path'),
        context: z.string().optional().describe('Optional context about the video (e.g. "CS lecture", "product demo")'),
        lang: z.string().optional().describe('Output language'),
      }),
    },
    async ({ input, context, lang }) => {
      try {
        const result = await analyzeVideo(input, context, lang);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'get_transcript',
    {
      title: 'Get Transcript',
      description: 'Read transcript from an existing vidistill output directory. Optionally filter by time range.',
      inputSchema: z.object({
        outputDir: z.string().describe('Path to a vidistill output directory'),
        startTime: z.number().optional().describe('Start time in seconds to filter from'),
        endTime: z.number().optional().describe('End time in seconds to filter to'),
      }),
    },
    async ({ outputDir, startTime, endTime }) => {
      try {
        const text = await getTranscript(outputDir, startTime, endTime);
        return {
          content: [{ type: 'text' as const, text }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'get_code',
    {
      title: 'Get Code',
      description: 'Read code files from an existing vidistill output directory.',
      inputSchema: z.object({
        outputDir: z.string().describe('Path to a vidistill output directory'),
      }),
    },
    async ({ outputDir }) => {
      try {
        const files = await getCode(outputDir);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(files) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true,
        };
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
}
