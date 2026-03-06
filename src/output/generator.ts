import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import type {
  GenerateOutputParams,
  OutputResult,
  ReRenderWithSpeakerMappingParams,
  SpeakerMapping,
  PipelineResult,
  VideoProfile,
  Pass1Result,
  Pass2Result,
  ChatExtraction,
  ImplicitSignals,
  PeopleExtraction,
  CodeReconstruction,
  SynthesisResult,
} from '../types/index.js';
import { writeGuide } from './guide.js';
import { writeTranscript } from './transcript.js';
import { writeCombined } from './combined.js';
import { writeCodeFiles } from './code-writer.js';
import { writeNotes } from './notes.js';
import { writePeople } from './people.js';
import { writeChat } from './chat.js';
import { writeLinks } from './links.js';
import { writeActionItems } from './action-items.js';
import { generateTimeline } from './timeline.js';
import { writeMetadata, writeRawOutput } from './metadata.js';
import { readJsonFile, buildExpandedMapping } from '../lib/utils.js';

/**
 * Convert a video title into a filesystem-safe slug:
 * lowercase, spaces and special chars replaced with hyphens,
 * trimmed, truncated to 100 chars.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/**
 * Determine which optional files to generate based solely on pass data presence.
 * synthesisResult.files_to_generate is never consulted for routing decisions.
 */
function resolveFilesToGenerate(params: GenerateOutputParams): Set<string> {
  const { pipelineResult } = params;
  const { synthesisResult, segments, peopleExtraction } = pipelineResult;

  // Always-generated files (handled separately): guide.md, transcript.md, metadata.json, raw/
  // This set tracks the optional files to generate
  const optional = new Set<string>();

  const hasPass2 = segments.some((s) => s.pass2 != null);
  const hasPass3a = pipelineResult.codeReconstruction != null;
  const hasPass3c = segments.some((s) => s.pass3c != null);
  const hasPass3d = segments.some((s) => s.pass3d != null);

  if (hasPass2) optional.add('combined.md');
  if (hasPass3a) optional.add('code/');
  if (hasPass3c) {
    optional.add('chat.md');
    optional.add('links.md');
  }
  if (hasPass3d) {
    optional.add('action-items.md');
  }
  if (synthesisResult != null || hasPass3d) optional.add('notes.md');
  if (peopleExtraction != null) optional.add('people.md');
  const hasPass1 = segments.some((s) => s.pass1 != null);
  if (hasPass1 || hasPass2) optional.add('timeline.html');

  return optional;
}

export async function generateOutput(params: GenerateOutputParams): Promise<OutputResult> {
  const { pipelineResult, outputDir, videoTitle, source, duration, model, processingTimeMs, speakerMapping, declinedMerges } = params;

  const slug = slugify(videoTitle);
  const finalOutputDir = join(outputDir, slug);

  // Step 1: Create the output directory
  await mkdir(finalOutputDir, { recursive: true });

  const filesGenerated: string[] = [];
  const errors: string[] = [];

  const filesToGenerate = resolveFilesToGenerate(params);

  // Build expanded mapping that includes detected-name keys for cross-referencing
  const expandedMapping = speakerMapping
    ? buildExpandedMapping(pipelineResult.segments, speakerMapping, pipelineResult.peopleExtraction)
    : undefined;

  // Helper: write a file and record it
  async function writeOutputFile(filename: string, content: string): Promise<void> {
    const fullPath = join(finalOutputDir, filename);
    const dir = dirname(fullPath);
    if (dir !== finalOutputDir) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(fullPath, content, 'utf8');
    filesGenerated.push(filename);
  }

  // Step 2a: transcript.md — always generated
  try {
    const content = writeTranscript({ pipelineResult, speakerMapping: expandedMapping });
    await writeOutputFile('transcript.md', content);
  } catch (err) {
    errors.push(`transcript.md: ${String(err)}`);
  }

  // Step 2b: combined.md — conditional
  if (filesToGenerate.has('combined.md')) {
    try {
      const content = writeCombined({ pipelineResult, speakerMapping: expandedMapping });
      await writeOutputFile('combined.md', content);
    } catch (err) {
      errors.push(`combined.md: ${String(err)}`);
    }
  }

  // Step 2c: code/ directory — conditional
  if (filesToGenerate.has('code/')) {
    try {
      const uncertainSet = new Set(pipelineResult.uncertainCodeFiles ?? []);
      const { files, timeline } = writeCodeFiles({ pipelineResult, uncertainFiles: uncertainSet });
      // Write individual code files
      for (const [filename, content] of files) {
        try {
          await writeOutputFile(`code/${filename}`, content);
        } catch (fileErr) {
          errors.push(`code/${filename}: ${String(fileErr)}`);
        }
      }
      // Write code timeline
      try {
        await writeOutputFile('code/code-timeline.md', timeline);
      } catch (tlErr) {
        errors.push(`code/code-timeline.md: ${String(tlErr)}`);
      }
    } catch (err) {
      errors.push(`code/: ${String(err)}`);
    }
  }

  // Step 2d: notes.md — conditional
  if (filesToGenerate.has('notes.md')) {
    try {
      const content = writeNotes({ synthesisResult: pipelineResult.synthesisResult, segments: pipelineResult.segments, speakerMapping: expandedMapping });
      if (content != null) {
        await writeOutputFile('notes.md', content);
      }
    } catch (err) {
      errors.push(`notes.md: ${String(err)}`);
    }
  }

  // Step 2e: people.md — conditional
  if (filesToGenerate.has('people.md')) {
    try {
      const content = writePeople({ peopleExtraction: pipelineResult.peopleExtraction, speakerMapping: expandedMapping, declinedMerges });
      if (content != null) {
        await writeOutputFile('people.md', content);
      }
    } catch (err) {
      errors.push(`people.md: ${String(err)}`);
    }
  }

  // Step 2f: chat.md — conditional
  if (filesToGenerate.has('chat.md')) {
    try {
      const content = writeChat({ segments: pipelineResult.segments, speakerMapping: expandedMapping });
      if (content != null) {
        await writeOutputFile('chat.md', content);
      }
    } catch (err) {
      errors.push(`chat.md: ${String(err)}`);
    }
  }

  // Step 2g: links.md — conditional
  if (filesToGenerate.has('links.md')) {
    try {
      const content = writeLinks({ segments: pipelineResult.segments });
      if (content != null) {
        await writeOutputFile('links.md', content);
      }
    } catch (err) {
      errors.push(`links.md: ${String(err)}`);
    }
  }

  // Step 2h: action-items.md — conditional
  if (filesToGenerate.has('action-items.md')) {
    try {
      const content = writeActionItems({
        segments: pipelineResult.segments,
        synthesisResult: pipelineResult.synthesisResult,
        speakerMapping: expandedMapping,
      });
      if (content != null) {
        await writeOutputFile('action-items.md', content);
      }
    } catch (err) {
      errors.push(`action-items.md: ${String(err)}`);
    }
  }

  // Step 2i: timeline.html — conditional on pass1 or pass2 data
  if (filesToGenerate.has('timeline.html')) {
    try {
      const content = generateTimeline({ pipelineResult, duration, speakerMapping: expandedMapping });
      await writeOutputFile('timeline.html', content);
    } catch (err) {
      errors.push(`timeline.html: ${String(err)}`);
    }
  }

  // Step 3: raw/ directory — always generated
  try {
    const rawFiles = writeRawOutput(pipelineResult);
    await mkdir(join(finalOutputDir, 'raw'), { recursive: true });
    for (const [filename, content] of rawFiles) {
      try {
        await writeOutputFile(`raw/${filename}`, content);
      } catch (fileErr) {
        errors.push(`raw/${filename}: ${String(fileErr)}`);
      }
    }
  } catch (err) {
    errors.push(`raw/: ${String(err)}`);
  }

  // Step 4: metadata.json — always generated, written AFTER other files
  try {
    const content = writeMetadata({
      title: videoTitle,
      source,
      duration,
      model,
      processingTimeMs,
      filesGenerated: [...filesGenerated],
      pipelineResult,
      speakerMapping,
    });
    await writeOutputFile('metadata.json', content);
  } catch (err) {
    errors.push(`metadata.json: ${String(err)}`);
  }

  // Step 5: guide.md — always generated, written LAST (needs full filesGenerated list)
  try {
    const content = writeGuide({ title: videoTitle, source, duration, pipelineResult, filesGenerated, speakerMapping: expandedMapping });
    await writeOutputFile('guide.md', content);
  } catch (err) {
    errors.push(`guide.md: ${String(err)}`);
  }

  return {
    outputDir: finalOutputDir,
    filesGenerated,
    errors,
  };
}

export async function reRenderWithSpeakerMapping(params: ReRenderWithSpeakerMappingParams): Promise<OutputResult> {
  const { outputDir, speakerMapping, declinedMerges } = params;

  const errors: string[] = [];
  const filesWritten: string[] = [];

  // Read metadata.json for non-raw fields
  const metadata = await readJsonFile<{
    videoTitle: string;
    source: string;
    duration: number;
    model: string;
    processingTimeMs: number;
    filesGenerated: string[];
    passesRun: string[];
    errors: string[];
  }>(join(outputDir, 'metadata.json'));

  const videoTitle = metadata?.videoTitle ?? '';
  const source = metadata?.source ?? '';
  const duration = metadata?.duration ?? 0;
  const model = metadata?.model ?? '';
  const processingTimeMs = metadata?.processingTimeMs ?? 0;
  const filesGenerated = metadata?.filesGenerated ?? [];

  // Reconstruct PipelineResult from raw/ JSON
  const rawDir = join(outputDir, 'raw');

  const videoProfile = await readJsonFile<VideoProfile>(join(rawDir, 'pass0-scene.json'));
  const peopleExtraction = await readJsonFile<PeopleExtraction>(join(rawDir, 'pass3b-people.json'));
  const synthesisResult = await readJsonFile<SynthesisResult>(join(rawDir, 'synthesis.json'));
  const codeReconstruction = await readJsonFile<CodeReconstruction>(join(rawDir, 'pass3a.json'));

  // Discover and read segments in a single pass (avoids double file reads)
  const segments: { index: number; pass1: Pass1Result | null; pass2: Pass2Result | null; pass3c: ChatExtraction | null; pass3d: ImplicitSignals | null }[] = [];
  for (let n = 0; n < 1000; n++) {
    const pass1 = await readJsonFile<Pass1Result>(join(rawDir, `pass1-seg${n}.json`));
    const pass2 = await readJsonFile<Pass2Result>(join(rawDir, `pass2-seg${n}.json`));
    if (pass1 == null && pass2 == null) break;
    const pass3c = await readJsonFile<ChatExtraction>(join(rawDir, `pass3c-seg${n}.json`));
    const pass3d = await readJsonFile<ImplicitSignals>(join(rawDir, `pass3d-seg${n}.json`));
    segments.push({ index: n, pass1, pass2, pass3c, pass3d });
  }

  const pipelineResult: PipelineResult = {
    segments,
    passesRun: metadata?.passesRun ?? [],
    errors: metadata?.errors ?? [],
    videoProfile: videoProfile ?? undefined,
    peopleExtraction: peopleExtraction ?? undefined,
    synthesisResult: synthesisResult ?? undefined,
    codeReconstruction: codeReconstruction ?? undefined,
  };

  // Helper: write a file only if content changed, and record it
  async function writeOutputFile(filename: string, content: string): Promise<void> {
    const fullPath = join(outputDir, filename);
    // Skip write if content is unchanged
    try {
      const existing = await readFile(fullPath, 'utf8');
      if (existing === content) return;
    } catch {
      // File doesn't exist — proceed with write
    }
    const dir = dirname(fullPath);
    if (dir !== outputDir) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(fullPath, content, 'utf8');
    filesWritten.push(filename);
  }

  // Build expanded mapping that includes detected-name keys for cross-referencing
  const expandedMapping = buildExpandedMapping(pipelineResult.segments, speakerMapping, pipelineResult.peopleExtraction);

  // Re-render each file that was originally generated (skip raw/ files)
  const filesToReRender = new Set(filesGenerated.filter((f) => !f.startsWith('raw/')));

  if (filesToReRender.has('transcript.md')) {
    try {
      const content = writeTranscript({ pipelineResult, speakerMapping: expandedMapping });
      await writeOutputFile('transcript.md', content);
    } catch (err) {
      errors.push(`transcript.md: ${String(err)}`);
    }
  }

  if (filesToReRender.has('combined.md')) {
    try {
      const content = writeCombined({ pipelineResult, speakerMapping: expandedMapping });
      await writeOutputFile('combined.md', content);
    } catch (err) {
      errors.push(`combined.md: ${String(err)}`);
    }
  }

  if (filesToReRender.has('notes.md')) {
    try {
      const content = writeNotes({ synthesisResult: pipelineResult.synthesisResult, segments: pipelineResult.segments, speakerMapping: expandedMapping });
      if (content != null) await writeOutputFile('notes.md', content);
    } catch (err) {
      errors.push(`notes.md: ${String(err)}`);
    }
  }

  if (filesToReRender.has('people.md')) {
    try {
      const content = writePeople({ peopleExtraction: pipelineResult.peopleExtraction, speakerMapping: expandedMapping, declinedMerges });
      if (content != null) await writeOutputFile('people.md', content);
    } catch (err) {
      errors.push(`people.md: ${String(err)}`);
    }
  }

  if (filesToReRender.has('chat.md')) {
    try {
      const content = writeChat({ segments: pipelineResult.segments, speakerMapping: expandedMapping });
      if (content != null) await writeOutputFile('chat.md', content);
    } catch (err) {
      errors.push(`chat.md: ${String(err)}`);
    }
  }

  if (filesToReRender.has('action-items.md')) {
    try {
      const content = writeActionItems({
        segments: pipelineResult.segments,
        synthesisResult: pipelineResult.synthesisResult,
        speakerMapping: expandedMapping,
      });
      if (content != null) await writeOutputFile('action-items.md', content);
    } catch (err) {
      errors.push(`action-items.md: ${String(err)}`);
    }
  }

  if (filesToReRender.has('timeline.html')) {
    try {
      const content = generateTimeline({ pipelineResult, duration, speakerMapping: expandedMapping });
      await writeOutputFile('timeline.html', content);
    } catch (err) {
      errors.push(`timeline.html: ${String(err)}`);
    }
  }

  if (filesToReRender.has('guide.md')) {
    try {
      const content = writeGuide({ title: videoTitle, source, duration, pipelineResult, filesGenerated, speakerMapping: expandedMapping });
      await writeOutputFile('guide.md', content);
    } catch (err) {
      errors.push(`guide.md: ${String(err)}`);
    }
  }

  // Re-write metadata.json with updated speakerMapping and declinedMerges
  try {
    const content = writeMetadata({
      title: videoTitle,
      source,
      duration,
      model,
      processingTimeMs,
      filesGenerated,
      pipelineResult,
      speakerMapping,
      declinedMerges,
    });
    await writeOutputFile('metadata.json', content);
  } catch (err) {
    errors.push(`metadata.json: ${String(err)}`);
  }

  return {
    outputDir,
    filesGenerated: filesWritten,
    errors,
  };
}
