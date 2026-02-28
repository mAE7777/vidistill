import { defineCommand, runMain } from 'citty';
import { log } from '@clack/prompts';
import pc from 'picocolors';
import { basename, extname, resolve } from 'path';
import { showLogo, showIntro, showConfig } from './ui.js';
import { promptVideoSource, promptContext } from './prompts.js';
import { resolveApiKey } from './config.js';
import { createProgressDisplay } from './progress.js';
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

const DEFAULT_OUTPUT = './vidistill-output/';

const main = defineCommand({
  meta: {
    name: 'vidistill',
    description: 'Video Intelligence Distiller — turn video into structured notes',
  },
  args: {
    input: {
      type: 'positional',
      description: 'YouTube URL or local file path',
      required: false,
    },
    context: {
      type: 'string',
      description: 'Optional context about the video (e.g. "CS lecture", "product demo")',
      alias: 'c',
    },
    output: {
      type: 'string',
      description: `Output directory for generated notes (default: ${DEFAULT_OUTPUT})`,
      alias: 'o',
      default: DEFAULT_OUTPUT,
    },
  },
  async run({ args }) {
    // Step 1: Show logo and intro
    showLogo();
    showIntro();

    try {
      // Step 2: Resolve API key
      const apiKey = await resolveApiKey();

      // Step 3: Resolve video source
      const rawInput = args.input ?? (await promptVideoSource());

      // Step 4: Resolve context (prompt unless --context flag provided)
      const context = args.context ?? (await promptContext());

      // Step 5: Display resolved configuration
      showConfig({ input: rawInput, context, output: args.output });

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

      const mins = Math.floor(duration / 60);
      const secs = Math.round(duration % 60);
      log.info(`Duration: ${pc.cyan(`${mins}m ${secs}s`)} (${Math.round(duration)}s)`);

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
        onProgress: (status) => progress.update(status),
        onWait: (delayMs) => progress.onWait(delayMs),
        isShuttingDown: () => shutdownHandler.isShuttingDown(),
      });
      const elapsedMs = Date.now() - startTime;

      // Step 10: Deregister shutdown handler (pipeline complete)
      shutdownHandler.deregister();

      // Step 11: Show pipeline summary
      progress.complete(pipelineResult, elapsedMs);

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

      // Step 13: Display final output summary
      const fileCount = outputResult.filesGenerated.length;
      log.success(
        `Output: ${pc.cyan(finalOutputDir + '/')} — ${pc.cyan(String(fileCount))} files generated ${pc.dim('(guide.md for overview)')}`,
      );

      if (outputResult.errors.length > 0) {
        log.warn(`Output errors: ${pc.yellow(String(outputResult.errors.length))}`);
        for (const err of outputResult.errors) {
          log.warn(pc.dim(`  ${err}`));
        }
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const message = raw.split('\n')[0].slice(0, 200);
      log.error(pc.red(message));
      process.exit(1);
    }
  },
});

runMain(main);
