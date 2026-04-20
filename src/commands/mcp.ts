import { resolve, join, basename, extname } from 'path';
import { existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';

import { loadConfig } from '../cli/config.js';
import { GeminiClient } from '../gemini/client.js';
import { RateLimiter } from '../gemini/rate-limiter.js';
import { resolveInput } from '../input/resolver.js';
import { handleYouTube, extractVideoId, fetchYouTubeMetadata } from '../input/youtube.js';
import { handleLocalFile } from '../input/local-file.js';
import { handleRemoteUrl } from '../input/remote.js';
import { detectDuration } from '../input/duration.js';
import { runPipeline } from '../core/pipeline.js';
import { generateOutput, slugify } from '../output/generator.js';
import { readJsonFile, parseTimestamp } from '../lib/utils.js';
import { MODELS } from '../gemini/models.js';
import type { Pass1Result, SynthesisResult, PeopleExtraction, ImplicitSignals, ChatExtraction } from '../types/index.js';

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
  let ytAuthor: string | undefined;

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
    try {
      const meta = await fetchYouTubeMetadata(resolved.value);
      videoTitle = meta.title;
      ytAuthor = meta.author;
    } catch {
      const videoId = extractVideoId(resolved.value);
      videoTitle = videoId != null ? `youtube-${videoId}` : resolved.value;
    }
  } else if (resolved.type === 'remote') {
    const result = await handleRemoteUrl(resolved.value, client);
    fileUri = result.fileUri;
    mimeType = result.mimeType;
    try {
      duration = await detectDuration({
        geminiDuration: result.duration,
      });
    } catch {
      duration = result.duration ?? 600;
    }
    videoTitle = result.title;
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

  const startTime = Date.now();
  const pipelineResult = await runPipeline({
    client,
    fileUri,
    mimeType,
    duration,
    model,
    context,
    lang,
    channelAuthor: ytAuthor,
    rateLimiter,
  });
  const elapsedMs = Date.now() - startTime;

  await generateOutput({
    pipelineResult,
    outputDir,
    videoTitle,
    source: input,
    duration,
    model,
    processingTimeMs: elapsedMs,
    channelAuthor: ytAuthor,
    ...(resolved.type === 'local' ? { inputFilePath: resolved.value } : {}),
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

/**
 * Read notes from an existing output directory.
 */
export async function getNotes(outputDir: string): Promise<string> {
  const absDir = resolve(outputDir);
  if (!existsSync(absDir)) {
    throw new Error('Not a vidistill output directory');
  }

  const synthesisPath = join(absDir, 'raw', 'synthesis.json');
  const synthesis = await readJsonFile<SynthesisResult>(synthesisPath);
  if (synthesis == null) {
    throw new Error('No notes data found');
  }

  const lines: string[] = [];

  lines.push('## Overview');
  lines.push(synthesis.overview ?? '');

  if (synthesis.key_decisions && synthesis.key_decisions.length > 0) {
    lines.push('');
    lines.push('## Key Decisions');
    for (const d of synthesis.key_decisions) {
      lines.push(`- [${d.timestamp}] ${d.decision}${d.context ? ` (${d.context})` : ''}`);
    }
  }

  if (synthesis.key_concepts && synthesis.key_concepts.length > 0) {
    lines.push('');
    lines.push('## Key Concepts');
    for (const c of synthesis.key_concepts) {
      lines.push(`- [${c.timestamp}] ${c.concept}: ${c.explanation}`);
    }
  }

  if (synthesis.topics && synthesis.topics.length > 0) {
    lines.push('');
    lines.push('## Topics');
    for (const t of synthesis.topics) {
      lines.push(`### ${t.title}`);
      lines.push(t.summary);
      if (t.key_points && t.key_points.length > 0) {
        for (const p of t.key_points) {
          lines.push(`- ${p}`);
        }
      }
    }
  }

  if (synthesis.suggestions && synthesis.suggestions.length > 0) {
    lines.push('');
    lines.push('## Suggestions');
    for (const s of synthesis.suggestions) {
      lines.push(`- ${s}`);
    }
  }

  return lines.join('\n');
}

/**
 * Read people/participants from an existing output directory.
 */
export async function getPeople(outputDir: string): Promise<string> {
  const absDir = resolve(outputDir);
  if (!existsSync(absDir)) {
    throw new Error('Not a vidistill output directory');
  }

  const peoplePath = join(absDir, 'raw', 'pass3b-people.json');
  const people = await readJsonFile<PeopleExtraction>(peoplePath);
  if (people == null || !Array.isArray(people.participants) || people.participants.length === 0) {
    throw new Error('No people data found');
  }

  const lines: string[] = [];

  for (const participant of people.participants) {
    lines.push(`### ${participant.name}`);
    if (participant.role) {
      lines.push(`- Role: ${participant.role}`);
    }
    if (participant.organization) {
      lines.push(`- Organization: ${participant.organization}`);
    }
    if (participant.contributions && participant.contributions.length > 0) {
      lines.push('- Contributions:');
      for (const c of participant.contributions) {
        lines.push(`  - ${c}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Read action items from pass3d implicit signals in an existing output directory.
 */
export async function getActionItems(outputDir: string): Promise<string> {
  const absDir = resolve(outputDir);
  if (!existsSync(absDir)) {
    throw new Error('Not a vidistill output directory');
  }

  const rawDir = join(absDir, 'raw');
  if (!existsSync(rawDir)) {
    throw new Error('No action items found');
  }

  const files = await readdir(rawDir);
  const pass3dFiles = files.filter(f => /^pass3d-seg\d+\.json$/.test(f)).sort();

  if (pass3dFiles.length === 0) {
    throw new Error('No action items found');
  }

  const allTasks: Array<{ timestamp: string; assignee: string; task: string; deadline: string }> = [];

  for (const file of pass3dFiles) {
    const data = await readJsonFile<ImplicitSignals>(join(rawDir, file));
    if (data?.tasks_assigned == null) continue;
    for (const t of data.tasks_assigned) {
      allTasks.push(t);
    }
  }

  if (allTasks.length === 0) {
    throw new Error('No action items found');
  }

  allTasks.sort((a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp));

  const lines = allTasks.map(t => `[${t.timestamp}] ${t.assignee}: ${t.task} (${t.deadline})`);
  return lines.join('\n');
}

/**
 * Read chat messages from pass3c files in an existing output directory.
 */
export async function getChat(outputDir: string): Promise<string> {
  const absDir = resolve(outputDir);
  if (!existsSync(absDir)) {
    throw new Error('Not a vidistill output directory');
  }

  const rawDir = join(absDir, 'raw');
  if (!existsSync(rawDir)) {
    throw new Error('No chat data found');
  }

  const files = await readdir(rawDir);
  const pass3cFiles = files.filter(f => /^pass3c-seg\d+\.json$/.test(f)).sort();

  if (pass3cFiles.length === 0) {
    throw new Error('No chat data found');
  }

  const allMessages: Array<{ timestamp: string; sender: string; text: string }> = [];

  for (const file of pass3cFiles) {
    const data = await readJsonFile<ChatExtraction>(join(rawDir, file));
    if (data?.messages == null) continue;
    for (const m of data.messages) {
      allMessages.push(m);
    }
  }

  if (allMessages.length === 0) {
    throw new Error('No chat data found');
  }

  allMessages.sort((a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp));

  const lines = allMessages.map(m => `[${m.timestamp}] ${m.sender}: ${m.text}`);
  return lines.join('\n');
}

/**
 * Read links from an existing output directory.
 * Prefers links.md if present; falls back to pass3c segment JSON files.
 */
export async function getLinks(outputDir: string): Promise<string> {
  const absDir = resolve(outputDir);
  if (!existsSync(absDir)) {
    throw new Error('Not a vidistill output directory');
  }

  try {
    const content = await readFile(join(absDir, 'links.md'), 'utf8');
    if (content.trim().length > 0) {
      return content;
    }
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  const rawDir = join(absDir, 'raw');
  if (!existsSync(rawDir)) {
    throw new Error('No links found');
  }

  const files = await readdir(rawDir);
  const pass3cFiles = files.filter(f => /^pass3c-seg\d+\.json$/.test(f)).sort();

  const seen = new Set<string>();
  const lines: string[] = [];

  for (const file of pass3cFiles) {
    const data = await readJsonFile<ChatExtraction>(join(rawDir, file));
    if (data?.links == null) continue;
    for (const link of data.links) {
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      lines.push(`[${link.timestamp}] ${link.url} — ${link.context}`);
    }
  }

  if (lines.length === 0) {
    throw new Error('No links found');
  }

  return lines.join('\n');
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

  server.registerTool(
    'get_notes',
    {
      title: 'Get Notes',
      description: 'Read synthesized notes from an existing vidistill output directory. Returns overview, key decisions, key concepts, topics, and suggestions.',
      inputSchema: z.object({
        outputDir: z.string().describe('Path to a vidistill output directory'),
      }),
    },
    async ({ outputDir }) => {
      try {
        const text = await getNotes(outputDir);
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
    'get_people',
    {
      title: 'Get People',
      description: 'Read participant details from an existing vidistill output directory. Returns name, role, organization, and contributions for each participant.',
      inputSchema: z.object({
        outputDir: z.string().describe('Path to a vidistill output directory'),
      }),
    },
    async ({ outputDir }) => {
      try {
        const text = await getPeople(outputDir);
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
    'get_action_items',
    {
      title: 'Get Action Items',
      description: 'Read action items assigned during a video from an existing vidistill output directory. Returns timestamp, assignee, task, and deadline.',
      inputSchema: z.object({
        outputDir: z.string().describe('Path to a vidistill output directory'),
      }),
    },
    async ({ outputDir }) => {
      try {
        const text = await getActionItems(outputDir);
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
    'get_chat',
    {
      title: 'Get Chat',
      description: 'Read chat messages from an existing vidistill output directory. Returns messages sorted by timestamp.',
      inputSchema: z.object({
        outputDir: z.string().describe('Path to a vidistill output directory'),
      }),
    },
    async ({ outputDir }) => {
      try {
        const text = await getChat(outputDir);
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
    'get_links',
    {
      title: 'Get Links',
      description: 'Read links shared during a video from an existing vidistill output directory. Returns formatted link entries with timestamp, URL, and context.',
      inputSchema: z.object({
        outputDir: z.string().describe('Path to a vidistill output directory'),
      }),
    },
    async ({ outputDir }) => {
      try {
        const text = await getLinks(outputDir);
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

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
}
