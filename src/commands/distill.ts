import { log, cancel } from '@clack/prompts';
import pc from 'picocolors';
import { basename, extname, resolve, join } from 'path';
import { existsSync, openSync, readSync, closeSync } from 'fs';
import { readdir, rm } from 'fs/promises';
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
import { generateOutput, slugify } from '../output/generator.js';
import { createShutdownHandler } from '../core/shutdown.js';
import { MODELS } from '../gemini/models.js';

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
 * Delete all contents of a directory without removing the directory itself.
 */
async function clearDirectory(dir: string): Promise<void> {
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
    try {
      duration = await detectDuration({
        ytDlpDuration: result.duration,
        geminiDuration: result.duration,
      });
    } catch {
      duration = 600;
      log.warn('Could not detect video duration — defaulting to 10 minutes. Install yt-dlp for full-length processing: brew install yt-dlp');
    }
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

  // Clear any stale output from a previous run
  if (existsSync(finalOutputDir)) {
    await clearDirectory(finalOutputDir);
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

  // Step 13: Clean completion output
  const elapsedSecs = Math.round(elapsedMs / 1000);
  const elapsedMins = Math.floor(elapsedSecs / 60);
  const remainSecs = elapsedSecs % 60;
  const elapsed = elapsedMins > 0 ? `${elapsedMins}m ${remainSecs}s` : `${remainSecs}s`;

  log.success(`Done in ${elapsed}`);
  log.info(`Output: ${finalOutputDir}/`);
  log.info(pc.dim('Open guide.md for an overview'));

  // Contextual tip
  if (
    pipelineResult.peopleExtraction?.participants != null &&
    pipelineResult.peopleExtraction.participants.length > 1
  ) {
    log.info(pc.dim('Tip: vidistill rename-speakers <dir> to assign real names'));
  }

  if (outputResult.errors.length > 0) {
    log.warn(`Output errors: ${pc.yellow(String(outputResult.errors.length))}`);
    for (const err of outputResult.errors) {
      log.warn(pc.dim(`  ${err}`));
    }
  }
}
