import { log, cancel, select, isCancel } from '@clack/prompts';
import pc from 'picocolors';
import { basename, extname, resolve, join } from 'path';
import { existsSync, openSync, readSync, closeSync } from 'fs';
import { readFile, writeFile, rm, mkdir } from 'fs/promises';
import { showConfigBox } from '../cli/ui.js';
import { promptVideoSource, promptContext, promptConfirmation } from '../cli/prompts.js';
import { resolveApiKey } from '../cli/config.js';
import { createProgressDisplay } from '../cli/progress.js';
import { GeminiClient } from '../gemini/client.js';
import { RateLimiter } from '../gemini/rate-limiter.js';
import { resolveInput } from '../input/resolver.js';
import { handleYouTube, extractVideoId } from '../input/youtube.js';
import { handleLocalFile } from '../input/local-file.js';
import { detectDuration } from '../input/duration.js';
import { runPipeline } from '../core/pipeline.js';
import { generateOutput, reRenderWithSpeakerMapping, slugify } from '../output/generator.js';
import { createShutdownHandler } from '../core/shutdown.js';
import { MODELS } from '../gemini/models.js';
import { determineStrategy } from '../core/strategy.js';
import { promptSpeakerNames } from '../cli/speaker-naming.js';
import type { ProgressFile, VideoProfile, PassStrategy } from '../types/index.js';

declare const VIDISTILL_VERSION: string;

const PROGRESS_SCHEMA_VERSION = 1;

/**
 * Quick audio detection from magic bytes for pre-pipeline display purposes.
 * Returns true if the file at the given path appears to be an audio file.
 */
function peekIsAudio(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(12);
    try {
      readSync(fd, buf, 0, 12, 0);
    } finally {
      closeSync(fd);
    }
    // ID3-tagged MP3
    if (buf.slice(0, 3).toString('ascii') === 'ID3') return true;
    // AAC ADTS — 0xFFF sync + layer bits == 00
    if (buf[0] === 0xff && (buf[1] & 0xf0) === 0xf0 && (buf[1] & 0x06) === 0x00) return true;
    // MP3 / MPEG audio sync — byte 0 == 0xFF, bits 7-5 == 111, layer != 00
    if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0x00) return true;
    // FLAC
    if (buf.slice(0, 4).toString('ascii') === 'fLaC') return true;
    // OGG
    if (buf.slice(0, 4).toString('ascii') === 'OggS') return true;
    // WAV
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WAVE') return true;
    // M4A brand in ftyp box
    if (buf.slice(4, 8).toString('ascii') === 'ftyp') {
      const brand = buf.slice(8, 12).toString('ascii');
      if (brand === 'M4A ' || brand === 'M4B ') return true;
      const ext = extname(filePath).toLowerCase();
      if (ext === '.m4a' || ext === '.m4b') return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Parse a semver string into [major, minor, patch].
 * Returns [0, 0, 0] on failure.
 */
function parseSemver(version: string): [number, number, number] {
  const parts = version.split('.').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * Read and parse progress.json from the given output directory.
 * Returns null if the file does not exist or cannot be parsed.
 */
async function readProgressFile(outputDir: string): Promise<ProgressFile | null> {
  const progressPath = join(outputDir, 'progress.json');
  if (!existsSync(progressPath)) return null;
  try {
    const raw = await readFile(progressPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj['schemaVersion'] !== 'number' || typeof obj['vidistillVersion'] !== 'string' || typeof obj['completedPasses'] !== 'object') return null;
    return parsed as ProgressFile;
  } catch {
    return null;
  }
}

/**
 * Write progress.json to the output directory.
 */
async function writeProgressFile(outputDir: string, progressFile: ProgressFile): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const progressPath = join(outputDir, 'progress.json');
  await writeFile(progressPath, JSON.stringify(progressFile, null, 2), 'utf8');
}

/**
 * Validate that each raw file referenced by completedPasses exists and is parseable.
 * Returns the list of invalid pass keys.
 */
async function validateCompletedPasses(outputDir: string, completedPasses: Record<string, string>): Promise<string[]> {
  const invalid: string[] = [];
  for (const [passKey, rawFile] of Object.entries(completedPasses)) {
    const rawPath = join(outputDir, 'raw', `${rawFile}.json`);
    if (!existsSync(rawPath)) {
      invalid.push(passKey);
      continue;
    }
    try {
      const content = await readFile(rawPath, 'utf8');
      JSON.parse(content);
    } catch {
      invalid.push(passKey);
    }
  }
  return invalid;
}

/**
 * Load preloaded results from raw/ JSON files for the given completed passes.
 */
async function loadPreloadedResults(outputDir: string, completedPasses: Record<string, string>): Promise<Record<string, unknown>> {
  const preloaded: Record<string, unknown> = {};
  for (const [passKey, rawFile] of Object.entries(completedPasses)) {
    const rawPath = join(outputDir, 'raw', `${rawFile}.json`);
    try {
      const content = await readFile(rawPath, 'utf8');
      const parsed: unknown = JSON.parse(content);
      if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      preloaded[passKey] = parsed;
    } catch {
      // skip files that can't be loaded
    }
  }
  return preloaded;
}

/**
 * Delete all contents of a directory without removing the directory itself.
 */
async function clearDirectory(dir: string): Promise<void> {
  const { readdir } = await import('fs/promises');
  const entries = await readdir(dir);
  await Promise.all(
    entries.map(entry => rm(join(dir, entry), { recursive: true, force: true })),
  );
}

export interface DistillArgs {
  input?: string;
  context?: string;
  output: string;
  lang?: string;
}

export async function runDistill(args: DistillArgs): Promise<void> {
  // Step 2: Resolve API key
  const apiKey = await resolveApiKey();

  // Step 3: Resolve video source
  let rawInput = args.input ?? (await promptVideoSource());

  // Step 4: Resolve context (prompt unless --context flag provided)
  let context = args.context ?? (await promptContext());

  // Step 5: Display configuration and confirm (skip when all inputs provided via CLI flags)
  const allFlagsProvided = args.input != null && args.context != null;

  if (!allFlagsProvided) {
    let confirmed = false;
    while (!confirmed) {
      // Peek at audio type for display — best-effort, no error if file not yet accessible
      const looksLikeUrl = /^https?:\/\/|^www\./i.test(rawInput.trim());
      const inputIsAudio = !looksLikeUrl && peekIsAudio(rawInput.trim());
      showConfigBox({
        input: rawInput,
        context,
        output: args.output,
        videoType: inputIsAudio ? 'audio' : undefined,
        lang: args.lang,
      });
      const choice = await promptConfirmation();
      switch (choice) {
        case 'start':
          confirmed = true;
          break;
        case 'edit-video':
          rawInput = await promptVideoSource();
          break;
        case 'edit-context':
          context = await promptContext();
          break;
        case 'cancel':
          cancel('Cancelled.');
          process.exit(0);
      }
    }
  }

  // Step 6: Parse and route the input, capturing fileUri + mimeType for the pipeline
  const resolved = resolveInput(rawInput);
  const client = new GeminiClient(apiKey);

  let fileUri: string;
  let mimeType: string;
  let duration: number;
  let videoTitle: string;
  let uploadedFileNames: string[] = [];

  if (resolved.type === 'youtube') {
    const result = await handleYouTube(resolved.value, client);
    fileUri = result.fileUri;
    mimeType = result.mimeType;
    duration = await detectDuration({
      ytDlpDuration: result.duration,
      geminiDuration: result.duration,
    });
    if (result.uploadedFileName != null) {
      uploadedFileNames = [result.uploadedFileName];
    }
    // Derive title: prefer video ID from URL, fall back to raw URL
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
    if (result.uploadedFileName != null) {
      uploadedFileNames = [result.uploadedFileName];
    }
    // Derive title from local filename (without extension)
    videoTitle = basename(resolved.value, extname(resolved.value));
  }

  const model = MODELS.flash;
  const outputDir = resolve(args.output);
  const slug = slugify(videoTitle);
  const finalOutputDir = `${outputDir}/${slug}`;

  // Step 6.5: Resume detection
  let preloadedResults: Record<string, unknown> | undefined;
  let overrideStrategy: PassStrategy | undefined;
  const progressFile = await readProgressFile(finalOutputDir);

  if (progressFile != null) {
    // Schema version check
    if (progressFile.schemaVersion > PROGRESS_SCHEMA_VERSION) {
      log.error(
        `This progress file was created by a newer version of vidistill. Please upgrade. (file schemaVersion: ${String(progressFile.schemaVersion)}, current: ${String(PROGRESS_SCHEMA_VERSION)})`,
      );
      process.exit(1);
    }

    // Version compatibility check
    const currentVer = parseSemver(VIDISTILL_VERSION);
    const fileVer = parseSemver(progressFile.vidistillVersion);
    const sameMajorMinor = currentVer[0] === fileVer[0] && currentVer[1] === fileVer[1];
    let versionWarning: string | null = null;
    if (!sameMajorMinor) {
      versionWarning = `Progress file was created by v${progressFile.vidistillVersion}, current is v${VIDISTILL_VERSION}.`;
    }

    // Validate raw files
    const invalidPasses = await validateCompletedPasses(finalOutputDir, progressFile.completedPasses);
    if (invalidPasses.length > 0) {
      log.warn(`Some completed pass files are missing or corrupt: ${invalidPasses.join(', ')}`);
    }

    const validPasses = Object.fromEntries(
      Object.entries(progressFile.completedPasses).filter(([key]) => !invalidPasses.includes(key)),
    );

    const completedCount = Object.keys(validPasses).length;

    if (versionWarning != null) {
      log.warn(versionWarning);
    }

    const resumeChoice = await select({
      message: `Found incomplete run (${String(completedCount)} passes done). Resume?`,
      options: [
        { value: 'resume', label: 'Resume' },
        { value: 'fresh', label: 'Fresh start' },
        { value: 'cancel', label: 'Cancel' },
      ],
    });

    if (isCancel(resumeChoice)) {
      cancel('Cancelled.');
      process.exit(0);
    }

    if (resumeChoice === 'cancel') {
      cancel('Cancelled.');
      process.exit(0);
    } else if (resumeChoice === 'fresh') {
      if (existsSync(finalOutputDir)) {
        await clearDirectory(finalOutputDir);
      }
      // proceed with clean state
    } else {
      // resume
      preloadedResults = await loadPreloadedResults(finalOutputDir, validPasses);
      // stash strategy for pipeline to recover
      if (progressFile.strategy != null) {
        overrideStrategy = progressFile.strategy;
        // also inject videoProfile via preloadedResults using pass0-scene key
        if (progressFile.videoProfile != null && !('pass0-scene' in preloadedResults)) {
          preloadedResults['pass0-scene'] = progressFile.videoProfile as VideoProfile;
        }
      }
    }
  }

  // Step 7: Create shutdown handler and register it before pipeline
  const shutdownHandler = createShutdownHandler({
    client,
    uploadedFileNames,
    outputDir,
    videoTitle,
    source: rawInput,
    duration,
    model,
  });
  shutdownHandler.register();

  // Step 8: Create rate limiter and progress display
  const rateLimiter = new RateLimiter();
  const progress = createProgressDisplay();

  // Build progress.json state incrementally
  const progressState: ProgressFile = {
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    vidistillVersion: VIDISTILL_VERSION,
    completedPasses: progressFile != null && preloadedResults != null
      ? { ...progressFile.completedPasses }
      : {},
    videoProfile: progressFile?.videoProfile,
    strategy: progressFile?.strategy,
  };

  // Step 9: Run the pipeline (Pass 0 + segmentation + passes happen internally)
  const startTime = Date.now();
  const pipelineResult = await runPipeline({
    client,
    fileUri,
    mimeType,
    duration,
    model,
    context,
    lang: args.lang,
    rateLimiter,
    onProgress: (status) => {
      progress.update(status);
      if (status.currentStep != null && status.totalSteps != null) {
        shutdownHandler.setProgress(status.currentStep, status.totalSteps);
      }
    },
    onWait: (delayMs) => progress.onWait(delayMs),
    isShuttingDown: () => shutdownHandler.isShuttingDown(),
    preloadedResults,
    overrideStrategy,
    onPassComplete: (passKey, result) => {
      if (result == null) return;
      // The raw file name matches passKey (the key without .json)
      progressState.completedPasses[passKey] = passKey;
      // Update videoProfile/strategy when pass0-scene completes
      if (passKey === 'pass0-scene') {
        progressState.videoProfile = result as VideoProfile;
        progressState.strategy = determineStrategy(result as VideoProfile);
      }
      // Write progress.json asynchronously — fire and forget; no await to avoid blocking the pipeline
      writeProgressFile(finalOutputDir, progressState).catch(() => {
        // ignore write errors — progress.json is best-effort
      });
    },
  });
  const elapsedMs = Date.now() - startTime;

  // Step 10: Deregister shutdown handler (pipeline complete)
  shutdownHandler.deregister();

  // Step 11: Pipeline complete
  progress.complete(pipelineResult, elapsedMs);

  // If interrupted, shutdown handler already displayed the message — skip completion output
  if (pipelineResult.interrupted != null) {
    return;
  }

  // Step 12: Generate output files
  const outputResult = await generateOutput({
    pipelineResult,
    outputDir,
    videoTitle,
    source: rawInput,
    duration,
    model,
    processingTimeMs: elapsedMs,
  });

  // Step 12.5: Speaker naming prompt (post-output)
  const speakerMapping = await promptSpeakerNames(pipelineResult);
  if (speakerMapping != null && Object.keys(speakerMapping).length > 0) {
    await reRenderWithSpeakerMapping({ outputDir: outputResult.outputDir, speakerMapping });
  }

  // Step 13: Clean completion output
  const elapsedSecs = Math.round(elapsedMs / 1000);
  const elapsedMins = Math.floor(elapsedSecs / 60);
  const remainSecs = elapsedSecs % 60;
  const elapsed = elapsedMins > 0 ? `${elapsedMins}m ${remainSecs}s` : `${remainSecs}s`;

  log.success(`Done in ${elapsed}`);
  log.info(`Output: ${finalOutputDir}/`);
  log.info(pc.dim('Open guide.md for an overview'));

  // Contextual tip
  if (pipelineResult.codeReconstruction != null) {
    log.info(pc.dim('Tip: vidistill extract code <input> for code-only extraction next time'));
  } else if (
    pipelineResult.peopleExtraction?.participants != null &&
    pipelineResult.peopleExtraction.participants.length > 1
  ) {
    log.info(pc.dim('Tip: vidistill rename-speakers <dir> to assign real names'));
  } else {
    log.info(pc.dim('Tip: vidistill ask <dir> "your question" to query this video'));
  }

  if (outputResult.errors.length > 0) {
    log.warn(`Output errors: ${pc.yellow(String(outputResult.errors.length))}`);
    for (const err of outputResult.errors) {
      log.warn(pc.dim(`  ${err}`));
    }
  }
}
