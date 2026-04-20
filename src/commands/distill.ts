import { log, cancel, note, confirm } from '@clack/prompts';
import pc from 'picocolors';
import { basename, extname, resolve, join } from 'path';
import { existsSync, openSync, readSync, closeSync } from 'fs';
import { readdir, rm, writeFile } from 'fs/promises';
import { showConfigBox } from '../cli/ui.js';
import { promptVideoSource, promptContext, promptOutputName, promptConfirmation } from '../cli/prompts.js';
import { resolveApiKey } from '../cli/config.js';
import { createProgressDisplay } from '../cli/progress.js';
import { GeminiClient } from '../gemini/client.js';
import { RateLimiter } from '../gemini/rate-limiter.js';
import { resolveInput } from '../input/resolver.js';
import { handleYouTube, extractVideoId, fetchYouTubeMetadata } from '../input/youtube.js';
import { handleLocalFile } from '../input/local-file.js';
import { handleRemoteUrl } from '../input/remote.js';
import { detectDuration } from '../input/duration.js';
import { runPipeline } from '../core/pipeline.js';
import { generateOutput, slugify } from '../output/generator.js';
import { createShutdownHandler } from '../core/shutdown.js';
import { MODELS } from '../gemini/models.js';
import { parseBatchFile, generateBatchIndex } from '../core/batch.js';
import type { BatchResultItem } from '../core/batch.js';
import { estimateApiCalls } from '../core/estimator.js';
import type { VideoProfile, PassStrategy } from '../types/index.js';

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
  batch?: string;
}

async function processSingleItem(
  rawInput: string,
  context: string,
  outputDir: string,
  lang: string | undefined,
  apiKey: string,
  rateLimiter: RateLimiter,
  videoTitle?: string,
): Promise<{ title: string; duration: number; finalOutputDir: string }> {
  const resolved = resolveInput(rawInput);
  const client = new GeminiClient(apiKey);

  let fileUri: string;
  let mimeType: string;
  let duration: number;
  let resolvedTitle: string;
  let uploadedFileNames: string[] = [];
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
    } catch {
      duration = 600;
    }
    if (result.uploadedFileName != null) {
      uploadedFileNames = [result.uploadedFileName];
    }
    try {
      const meta = await fetchYouTubeMetadata(resolved.value);
      resolvedTitle = meta.title;
      ytAuthor = meta.author;
    } catch {
      const videoId = extractVideoId(resolved.value);
      resolvedTitle = videoId != null ? `youtube-${videoId}` : resolved.value;
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
    if (result.uploadedFileName != null) {
      uploadedFileNames = [result.uploadedFileName];
    }
    resolvedTitle = result.title;
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
    resolvedTitle = basename(resolved.value, extname(resolved.value));
  }

  const finalTitle = videoTitle ?? resolvedTitle;
  const model = MODELS.flash;
  const resolvedOutputDir = resolve(outputDir);
  const slug = slugify(finalTitle);
  const finalOutputDir = `${resolvedOutputDir}/${slug}`;

  if (existsSync(finalOutputDir)) {
    await clearDirectory(finalOutputDir);
  }

  const shutdownHandler = createShutdownHandler({
    client,
    uploadedFileNames,
    outputDir: resolvedOutputDir,
    videoTitle: finalTitle,
    source: rawInput,
    duration,
    model,
  });
  shutdownHandler.register();

  const progress = createProgressDisplay();

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

  shutdownHandler.deregister();
  progress.complete(pipelineResult, elapsedMs);

  await generateOutput({
    pipelineResult,
    outputDir: resolvedOutputDir,
    videoTitle: finalTitle,
    source: rawInput,
    duration,
    model,
    processingTimeMs: elapsedMs,
    channelAuthor: ytAuthor,
    ...(resolved.type === 'local' ? { inputFilePath: resolved.value } : {}),
  });

  return { title: finalTitle, duration, finalOutputDir };
}

async function runBatchMode(args: DistillArgs, apiKey: string): Promise<void> {
  const batchFile = args.batch!;
  const items = parseBatchFile(batchFile);

  if (items.length === 0) {
    log.warn('Batch file contains no items to process.');
    return;
  }

  log.info(`Processing ${items.length} item${items.length !== 1 ? 's' : ''} from batch file...`);

  const rateLimiter = new RateLimiter();
  const outputDir = resolve(args.output);
  const resultItems: BatchResultItem[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    log.info(`Processing ${i + 1}/${items.length}: ${item.input}`);

    try {
      const { title, duration, finalOutputDir } = await processSingleItem(
        item.input,
        item.context ?? args.context ?? '',
        args.output,
        args.lang,
        apiKey,
        rateLimiter,
      );

      resultItems.push({
        input: item.input,
        outputDir: finalOutputDir,
        title,
        duration,
        success: true,
      });

      log.success(`  Done: ${title}`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.warn(`  Failed: ${errorMsg}`);

      resultItems.push({
        input: item.input,
        outputDir: join(outputDir, slugify(item.input)),
        title: item.input,
        duration: 0,
        success: false,
        error: errorMsg,
      });
    }
  }

  const batchResult = { items: resultItems };
  const indexContent = generateBatchIndex(batchResult, outputDir);
  const indexPath = join(outputDir, 'index.md');
  await writeFile(indexPath, indexContent, 'utf-8');

  const successCount = resultItems.filter((r) => r.success).length;
  log.success(`Batch complete: ${successCount}/${items.length} succeeded`);
  log.info(`Index written to ${indexPath}`);
}

export async function runDistill(args: DistillArgs): Promise<void> {
  // Step 2: Resolve API key
  const apiKey = await resolveApiKey();

  // Batch mode: delegate to batch handler
  if (args.batch != null) {
    return runBatchMode(args, apiKey);
  }

  // Step 3: Resolve video source
  let rawInput = args.input ?? (await promptVideoSource());

  // Step 4: Resolve context (prompt unless --context flag provided)
  let context = args.context ?? (await promptContext());

  // Step 4b: Optional output folder name
  let outputName: string | undefined = await promptOutputName();

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
        outputName,
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
        case 'edit-name':
          outputName = await promptOutputName();
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
    } catch {
      duration = 600;
      log.warn('Could not detect video duration — defaulting to 10 minutes. Install yt-dlp for full-length processing: brew install yt-dlp');
    }
    if (result.uploadedFileName != null) {
      uploadedFileNames = [result.uploadedFileName];
    }
    // Fetch real title and author from YouTube
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
    if (result.uploadedFileName != null) {
      uploadedFileNames = [result.uploadedFileName];
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
    if (result.uploadedFileName != null) {
      uploadedFileNames = [result.uploadedFileName];
    }
    // Derive title from local filename (without extension)
    videoTitle = basename(resolved.value, extname(resolved.value));
  }

  // Use user-provided output name if given
  if (outputName != null) {
    videoTitle = outputName;
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
    channelAuthor: ytAuthor,
    rateLimiter,
    onProgress: (status) => {
      progress.update(status);
      if (status.currentStep != null && status.totalSteps != null) {
        shutdownHandler.setProgress(status.currentStep, status.totalSteps);
      }
    },
    onWait: (delayMs) => progress.onWait(delayMs),
    isShuttingDown: () => shutdownHandler.isShuttingDown(),
    onPass0Complete: async (profile: VideoProfile, strategy: PassStrategy, segmentCount: number) => {
      const estimate = estimateApiCalls(strategy, segmentCount);
      const [minMin, maxMin] = estimate.estimatedMinutes;
      const minRounded = Math.round(minMin);
      const maxRounded = Math.round(maxMin);
      note(`~${estimate.totalCalls} API calls • est. ${minRounded}-${maxRounded} min`, 'Cost estimate');
      const shouldProceed = await confirm({ message: 'Proceed?' });
      return shouldProceed === true;
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
    channelAuthor: ytAuthor,
    ...(resolved.type === 'local' ? { inputFilePath: resolved.value } : {}),
  });

  // Step 13: Post-pipeline summary
  const elapsedSecs = Math.round(elapsedMs / 1000);
  const elapsedMins = Math.floor(elapsedSecs / 60);
  const remainSecs = elapsedSecs % 60;
  const elapsed = elapsedMins > 0 ? `${elapsedMins}m ${remainSecs}s` : `${remainSecs}s`;

  const summaryLines: string[] = [
    `API calls: ${pipelineResult.apiCallCount} • Duration: ${elapsed}`,
    `Errors: ${pipelineResult.errors.length}`,
  ];
  if (pipelineResult.consensusAgreementRate != null) {
    summaryLines.push(`Consensus: ${Math.round(pipelineResult.consensusAgreementRate * 100)}%`);
  }
  if (pipelineResult.tokenUsage != null) {
    const prompt = pipelineResult.tokenUsage.promptTokens.toLocaleString();
    const output = pipelineResult.tokenUsage.candidatesTokens.toLocaleString();
    summaryLines.push(`Tokens: ${prompt} prompt / ${output} output`);
  }
  note(summaryLines.join('\n'), 'Summary');

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
