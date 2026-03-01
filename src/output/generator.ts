import { mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import type { GenerateOutputParams, OutputResult } from '../types/index.js';
import { writeGuide } from './guide.js';
import { writeTranscript } from './transcript.js';
import { writeCombined } from './combined.js';
import { writeCodeFiles } from './code-writer.js';
import { writeNotes } from './notes.js';
import { writePeople } from './people.js';
import { writeChat } from './chat.js';
import { writeLinks } from './links.js';
import { writeActionItems } from './action-items.js';
import { writeInsights } from './insights.js';
import { writePrereqs } from './prereqs.js';
import { generateTimeline } from './timeline.js';
import { writeMetadata, writeRawOutput } from './metadata.js';

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
    optional.add('insights.md');
  }
  if (synthesisResult != null) optional.add('notes.md');
  if (peopleExtraction != null) optional.add('people.md');
  if (
    synthesisResult?.prerequisites != null &&
    Array.isArray(synthesisResult.prerequisites) &&
    synthesisResult.prerequisites.length > 0
  ) {
    optional.add('prereqs.md');
  }

  const hasPass1 = segments.some((s) => s.pass1 != null);
  if (hasPass1 || hasPass2) optional.add('timeline.html');

  return optional;
}

export async function generateOutput(params: GenerateOutputParams): Promise<OutputResult> {
  const { pipelineResult, outputDir, videoTitle, source, duration, model, processingTimeMs } = params;

  const slug = slugify(videoTitle);
  const finalOutputDir = join(outputDir, slug);

  // Step 1: Create the output directory
  await mkdir(finalOutputDir, { recursive: true });

  const filesGenerated: string[] = [];
  const errors: string[] = [];

  const filesToGenerate = resolveFilesToGenerate(params);

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
    const content = writeTranscript({ pipelineResult });
    await writeOutputFile('transcript.md', content);
  } catch (err) {
    errors.push(`transcript.md: ${String(err)}`);
  }

  // Step 2b: combined.md — conditional
  if (filesToGenerate.has('combined.md')) {
    try {
      const content = writeCombined({ pipelineResult });
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
      const content = writeNotes({ synthesisResult: pipelineResult.synthesisResult });
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
      const content = writePeople({ peopleExtraction: pipelineResult.peopleExtraction });
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
      const content = writeChat({ segments: pipelineResult.segments });
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
      });
      if (content != null) {
        await writeOutputFile('action-items.md', content);
      }
    } catch (err) {
      errors.push(`action-items.md: ${String(err)}`);
    }
  }

  // Step 2i: insights.md — conditional
  if (filesToGenerate.has('insights.md')) {
    try {
      const content = writeInsights({ segments: pipelineResult.segments });
      if (content != null) {
        await writeOutputFile('insights.md', content);
      }
    } catch (err) {
      errors.push(`insights.md: ${String(err)}`);
    }
  }

  // Step 2j: prereqs.md — conditional on non-empty prerequisites array
  if (filesToGenerate.has('prereqs.md')) {
    try {
      const content = writePrereqs({ prerequisites: pipelineResult.synthesisResult?.prerequisites });
      if (content != null) {
        await writeOutputFile('prereqs.md', content);
      }
    } catch (err) {
      errors.push(`prereqs.md: ${String(err)}`);
    }
  }

  // Step 2k: timeline.html — conditional on pass1 or pass2 data
  if (filesToGenerate.has('timeline.html')) {
    try {
      const content = generateTimeline({ pipelineResult, duration });
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
    });
    await writeOutputFile('metadata.json', content);
  } catch (err) {
    errors.push(`metadata.json: ${String(err)}`);
  }

  // Step 5: guide.md — always generated, written LAST (needs full filesGenerated list)
  try {
    const content = writeGuide({ title: videoTitle, source, duration, pipelineResult, filesGenerated });
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
