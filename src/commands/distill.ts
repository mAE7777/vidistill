import { log, cancel } from '@clack/prompts';
import pc from 'picocolors';
import { basename, extname, resolve } from 'path';
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
      showConfigBox({ input: rawInput, context, output: args.output });
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
