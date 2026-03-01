import { log } from '@clack/prompts';
import { existsSync, statSync, readdirSync, readFileSync } from 'fs';
import { resolve, basename, extname } from 'path';
import { resolveApiKey } from '../cli/config.js';
import { createProgressDisplay } from '../cli/progress.js';
import { GeminiClient } from '../gemini/client.js';
import { RateLimiter } from '../gemini/rate-limiter.js';
import { handleLocalFile } from '../input/local-file.js';
import { detectDuration } from '../input/duration.js';
import { runPipeline } from '../core/pipeline.js';
import { MODELS } from '../gemini/models.js';
import type {
  Pass1Result,
  Pass2Result,
  CodeReconstruction,
  PeopleExtraction,
  ChatExtraction,
  PassStrategy,
} from '../types/index.js';

const VALID_TYPES = ['code', 'links', 'people', 'transcript', 'commands'] as const;
type ExtractionType = (typeof VALID_TYPES)[number];

function isValidType(t: string): t is ExtractionType {
  return (VALID_TYPES as readonly string[]).includes(t);
}

/** Read and parse a JSON file from disk. Returns null on any error. */
function readJson<T>(filePath: string): T | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    if (parsed == null || typeof parsed !== 'object') return null;
    return parsed as T;
  } catch {
    return null;
  }
}

/** Return sorted list of files in dir matching a regex pattern. */
function listMatchingFiles(dir: string, pattern: RegExp): string[] {
  try {
    return readdirSync(dir)
      .filter(f => pattern.test(f))
      .sort((a, b) => {
        // Extract the segment index from the filename (the trailing digits before .json)
        const segIndexA = parseInt(a.match(/seg(\d+)\.json$/)?.[1] ?? '0', 10);
        const segIndexB = parseInt(b.match(/seg(\d+)\.json$/)?.[1] ?? '0', 10);
        return segIndexA - segIndexB;
      })
      .map(f => `${dir}/${f}`);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Output mode extractors
// ---------------------------------------------------------------------------

function extractTranscript(rawDir: string): void {
  const files = listMatchingFiles(rawDir, /^pass1-seg\d+\.json$/);
  if (files.length === 0) {
    log.info('No transcript data found (pass1-seg*.json missing)');
    return;
  }

  for (const filePath of files) {
    const data = readJson<Pass1Result>(filePath);
    if (data == null) continue;
    for (const entry of data.transcript_entries ?? []) {
      const speaker = entry.speaker ? `[${entry.speaker}] ` : '';
      console.log(`${entry.timestamp}  ${speaker}${entry.text}`);
    }
  }
}

function extractCode(rawDir: string): void {
  const filePath = `${rawDir}/pass3a.json`;
  if (!existsSync(filePath)) {
    log.info('No code data found (pass3a.json missing)');
    return;
  }

  const data = readJson<CodeReconstruction>(filePath);
  if (data == null || !Array.isArray(data.files) || data.files.length === 0) {
    log.info('No code files found in pass3a.json');
    return;
  }

  for (const file of data.files) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`// ${file.filename}`);
    console.log('='.repeat(60));
    console.log(file.final_content ?? '');
  }
}

function extractLinks(rawDir: string): void {
  const files = listMatchingFiles(rawDir, /^pass3c-seg\d+\.json$/);
  if (files.length === 0) {
    log.info('No link data found (pass3c-seg*.json missing)');
    return;
  }

  let found = 0;
  for (const filePath of files) {
    const data = readJson<ChatExtraction>(filePath);
    if (data == null) continue;
    for (const link of data.links ?? []) {
      console.log(`${link.url}`);
      if (link.context) {
        console.log(`  Context: ${link.context}`);
      }
      if (link.timestamp) {
        console.log(`  At: ${link.timestamp}`);
      }
      console.log('');
      found++;
    }
  }

  if (found === 0) {
    log.info('No links found in pass3c segments');
  }
}

function extractPeople(rawDir: string): void {
  const filePath = `${rawDir}/pass3b-people.json`;
  if (!existsSync(filePath)) {
    log.info('No people data found (pass3b-people.json missing)');
    return;
  }

  const data = readJson<PeopleExtraction>(filePath);
  if (data == null || !Array.isArray(data.participants) || data.participants.length === 0) {
    log.info('No participants found in pass3b-people.json');
    return;
  }

  for (const p of data.participants) {
    console.log(`\nName: ${p.name ?? 'Unknown'}`);
    if (p.role) console.log(`Role: ${p.role}`);
    if (p.organization) console.log(`Organization: ${p.organization}`);
    if (Array.isArray(p.contributions) && p.contributions.length > 0) {
      console.log('Contributions:');
      for (const c of p.contributions) {
        console.log(`  - ${c}`);
      }
    }
  }
}

function extractCommands(rawDir: string): void {
  const files = listMatchingFiles(rawDir, /^pass2-seg\d+\.json$/);
  if (files.length === 0) {
    log.info('No visual data found (pass2-seg*.json missing)');
    return;
  }

  let found = 0;
  for (const filePath of files) {
    const data = readJson<Pass2Result>(filePath);
    if (data == null) continue;
    for (const block of data.code_blocks ?? []) {
      if (block.screen_type?.toLowerCase().includes('terminal')) {
        console.log(`# ${block.timestamp}`);
        console.log(block.content ?? '');
        console.log('');
        found++;
      }
    }
  }

  if (found === 0) {
    log.info('No terminal commands found in pass2 segments');
  }
}

// ---------------------------------------------------------------------------
// Video mode: strategy per extraction type
// ---------------------------------------------------------------------------

function strategyForType(type: ExtractionType): PassStrategy {
  switch (type) {
    case 'transcript':
      return { passes: ['transcript'], resolution: 'medium', segmentMinutes: 10 };
    case 'code':
      return { passes: ['transcript', 'visual', 'code'], resolution: 'medium', segmentMinutes: 10 };
    case 'links':
      return { passes: ['transcript', 'visual', 'chat'], resolution: 'medium', segmentMinutes: 10 };
    case 'people':
      return { passes: ['transcript', 'people'], resolution: 'medium', segmentMinutes: 10 };
    case 'commands':
      return { passes: ['transcript', 'visual'], resolution: 'medium', segmentMinutes: 10 };
  }
}

function printVideoModeResults(type: ExtractionType, result: import('../types/index.js').PipelineResult): void {
  switch (type) {
    case 'transcript':
      for (const seg of result.segments) {
        for (const entry of seg.pass1?.transcript_entries ?? []) {
          const speaker = entry.speaker ? `[${entry.speaker}] ` : '';
          console.log(`${entry.timestamp}  ${speaker}${entry.text}`);
        }
      }
      break;

    case 'code':
      if (result.codeReconstruction == null || result.codeReconstruction.files.length === 0) {
        log.info('No code files extracted');
      } else {
        for (const file of result.codeReconstruction.files) {
          console.log(`\n${'='.repeat(60)}`);
          console.log(`// ${file.filename}`);
          console.log('='.repeat(60));
          console.log(file.final_content ?? '');
        }
      }
      break;

    case 'links':
      {
        let found = 0;
        for (const seg of result.segments) {
          for (const link of seg.pass3c?.links ?? []) {
            console.log(`${link.url}`);
            if (link.context) console.log(`  Context: ${link.context}`);
            if (link.timestamp) console.log(`  At: ${link.timestamp}`);
            console.log('');
            found++;
          }
        }
        if (found === 0) log.info('No links found');
      }
      break;

    case 'people':
      if (result.peopleExtraction == null || result.peopleExtraction.participants.length === 0) {
        log.info('No participants found');
      } else {
        for (const p of result.peopleExtraction.participants) {
          console.log(`\nName: ${p.name ?? 'Unknown'}`);
          if (p.role) console.log(`Role: ${p.role}`);
          if (p.organization) console.log(`Organization: ${p.organization}`);
          if (Array.isArray(p.contributions) && p.contributions.length > 0) {
            console.log('Contributions:');
            for (const c of p.contributions) console.log(`  - ${c}`);
          }
        }
      }
      break;

    case 'commands':
      {
        let found = 0;
        for (const seg of result.segments) {
          for (const block of seg.pass2?.code_blocks ?? []) {
            if (block.screen_type?.toLowerCase().includes('terminal')) {
              console.log(`# ${block.timestamp}`);
              console.log(block.content ?? '');
              console.log('');
              found++;
            }
          }
        }
        if (found === 0) log.info('No terminal commands found');
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Main run
// ---------------------------------------------------------------------------

export async function run(args: string[]): Promise<void> {
  // Parse: vidistill extract <type> <source> [--lang <lang>]
  let lang: string | undefined;
  const filteredArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lang' && args[i + 1] != null) {
      lang = args[++i];
    } else {
      filteredArgs.push(args[i]);
    }
  }

  const [typeArg, sourceArg] = filteredArgs;

  if (typeArg == null) {
    log.error(`Usage: vidistill extract <type> <source>`);
    log.error(`Valid types: ${VALID_TYPES.join(', ')}`);
    process.exit(1);
  }

  if (!isValidType(typeArg)) {
    log.error(`Unknown extraction type: "${typeArg}"`);
    log.error(`Valid types: ${VALID_TYPES.join(', ')}`);
    process.exit(1);
  }

  if (sourceArg == null) {
    log.error('Missing source: provide a vidistill output directory or a video file path');
    process.exit(1);
  }

  const sourcePath = resolve(sourceArg);
  const type: ExtractionType = typeArg;

  // Detect mode
  const sourceExists = existsSync(sourcePath);
  if (!sourceExists) {
    log.error(`Source not found: ${sourcePath}`);
    process.exit(1);
  }

  const isDir = statSync(sourcePath).isDirectory();

  if (isDir) {
    const metadataPath = `${sourcePath}/metadata.json`;
    if (!existsSync(metadataPath)) {
      log.error(`Not a vidistill output directory (metadata.json not found): ${sourcePath}`);
      process.exit(1);
    }

    // Output mode
    const rawDir = `${sourcePath}/raw`;
    switch (type) {
      case 'transcript':
        extractTranscript(rawDir);
        break;
      case 'code':
        extractCode(rawDir);
        break;
      case 'links':
        extractLinks(rawDir);
        break;
      case 'people':
        extractPeople(rawDir);
        break;
      case 'commands':
        extractCommands(rawDir);
        break;
    }

    return;
  }

  // Video mode
  const apiKey = await resolveApiKey();
  const client = new GeminiClient(apiKey);

  log.info(`Uploading ${basename(sourcePath)}...`);
  const localResult = await handleLocalFile(sourcePath, client);

  const duration = await detectDuration({
    filePath: sourcePath,
    geminiDuration: localResult.duration,
  });

  const overrideStrategy = strategyForType(type);
  const rateLimiter = new RateLimiter();
  const progress = createProgressDisplay();

  // Estimate segment count for display
  const estSegments = Math.max(1, Math.ceil(duration / (overrideStrategy.segmentMinutes * 60)));

  log.info(`Extracting ${type} (${estSegments} segment${estSegments !== 1 ? 's' : ''})...`);

  const pipelineResult = await runPipeline({
    client,
    fileUri: localResult.fileUri,
    mimeType: localResult.mimeType,
    duration,
    model: MODELS.flash,
    lang,
    rateLimiter,
    overrideStrategy,
    onProgress: (status) => {
      progress.update(status);
    },
    onWait: (delayMs) => progress.onWait(delayMs),
  });

  progress.complete(pipelineResult, 0);

  // Clean up uploaded file
  if (localResult.uploadedFileName != null) {
    try {
      await client.deleteFile(localResult.uploadedFileName);
    } catch {
      // best-effort cleanup
    }
  }

  printVideoModeResults(type, pipelineResult);

  if (pipelineResult.errors.length > 0) {
    log.info(`Completed with ${pipelineResult.errors.length} error(s)`);
  }
}
