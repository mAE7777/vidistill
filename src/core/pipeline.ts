import { log } from '@clack/prompts';
import { runTranscript } from '../passes/transcript.js';
import { runVisual } from '../passes/visual.js';
import { runSceneAnalysis } from '../passes/scene-analysis.js';
import { runCodeReconstruction } from '../passes/code.js';
import { runPeopleExtraction } from '../passes/people.js';
import { runChatExtraction } from '../passes/chat.js';
import { runImplicitSignals } from '../passes/implicit.js';
import { runSynthesis } from '../passes/synthesis.js';
import { determineStrategy } from './strategy.js';
import { createSegmentPlan } from './segmenter.js';
import { MODELS } from '../gemini/models.js';
import { runCodeConsensus, runLinkConsensus } from './consensus.js';
import { validateCodeReconstruction } from './validator.js';
import type {
  RunPipelineConfig,
  PipelineResult,
  SegmentResult,
  Pass1Result,
  Pass2Result,
  VideoProfile,
  PassStrategy,
  CodeReconstruction,
  ChatExtraction,
  ImplicitSignals,
  PeopleExtraction,
  SynthesisResult,
} from '../types/index.js';

const RETRY_DELAYS_MS = [2000, 4000, 8000];

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<{ result: T | null; error: string | null }> {
  let lastError: unknown;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      const result = await fn();
      return { result, error: null };
    } catch (e: unknown) {
      lastError = e;
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  return { result: null, error: `${label} failed after ${RETRY_DELAYS_MS.length + 1} attempts: ${msg}` };
}

const DEFAULT_PROFILE: VideoProfile = {
  type: 'mixed',
  speakers: { count: 0, identified: [] },
  visualContent: {
    hasCode: false,
    hasSlides: false,
    hasDiagrams: false,
    hasPeopleGrid: false,
    hasChatbox: false,
    hasWhiteboard: false,
    hasTerminal: false,
    hasScreenShare: false,
  },
  audioContent: { hasMultipleSpeakers: false, primaryLanguage: 'unknown', quality: 'medium' },
  complexity: 'moderate',
  recommendations: {
    resolution: 'medium',
    segmentMinutes: 10,
    passes: ['transcript', 'visual', 'code', 'people', 'chat', 'implicit', 'synthesis'],
  },
};

export async function runPipeline(config: RunPipelineConfig): Promise<PipelineResult> {
  const { client, fileUri, mimeType, duration, model, rateLimiter, onProgress, onWait, isShuttingDown, lang } = config;

  const errors: string[] = [];
  const passesRun: string[] = [];

  let videoProfile: VideoProfile;
  let strategy: PassStrategy;

  if (config.overrideStrategy != null) {
    // Skip Pass 0 when a strategy override is provided
    videoProfile = DEFAULT_PROFILE;
    strategy = config.overrideStrategy;
  } else {
    // Pass 0: Scene analysis
    onProgress?.({ phase: 'pass0', segment: 0, totalSegments: 1, status: 'running' });

    const pass0Attempt = await withRetry(
      () => rateLimiter.execute(() => runSceneAnalysis({ client, fileUri, mimeType, duration, model, lang }), { onWait }),
      'pass0',
    );

    if (pass0Attempt.error !== null) {
      log.warn(pass0Attempt.error);
      errors.push(pass0Attempt.error);
      videoProfile = DEFAULT_PROFILE;
    } else {
      videoProfile = pass0Attempt.result ?? DEFAULT_PROFILE;
    }

    strategy = determineStrategy(videoProfile);

    onProgress?.({ phase: 'pass0', segment: 0, totalSegments: 1, status: 'done' });
  }

  // Build segment plan from strategy
  const plan = createSegmentPlan(duration, {
    segmentMinutes: strategy.segmentMinutes,
    resolution: strategy.resolution,
  });
  const segments = plan.segments;
  const resolution = plan.resolution;

  const results: SegmentResult[] = [];
  const n = segments.length;

  // Calculate total steps for progress tracking
  const linkConsensusRuns = 3;
  const callsPerSegment =
    2 +
    (strategy.passes.includes('chat') ? linkConsensusRuns : 0) +
    (strategy.passes.includes('implicit') ? 1 : 0);
  const postSegmentCalls =
    (strategy.passes.includes('people') ? 1 : 0) +
    (strategy.passes.includes('code') ? 3 : 0) +
    (strategy.passes.includes('synthesis') ? 1 : 0);
  const totalSteps = n * callsPerSegment + postSegmentCalls;
  let currentStep = 0;

  let pass1RanOnce = false;
  let pass2RanOnce = false;
  let pass3cRanOnce = false;
  let pass3dRanOnce = false;

  let wasInterrupted = false;
  const interruptedPasses: string[] = [];

  for (let i = 0; i < n; i++) {
    if (isShuttingDown?.()) {
      wasInterrupted = true;
      // Record all remaining passes as incomplete
      interruptedPasses.push(`segments ${i}-${n - 1} (all passes)`);
      break;
    }

    const segment = segments[i];

    // Pass 1: Transcript
    onProgress?.({ phase: 'pass1', segment: i, totalSegments: n, status: 'running', totalSteps });

    let pass1: Pass1Result | null = null;
    const pass1Attempt = await withRetry(
      () => rateLimiter.execute(() => runTranscript({ client, fileUri, mimeType, segment, model, resolution, lang }), { onWait }),
      `segment ${i} pass1`,
    );

    if (pass1Attempt.error !== null) {
      log.warn(pass1Attempt.error);
      errors.push(pass1Attempt.error);
    } else {
      pass1 = pass1Attempt.result;
      pass1RanOnce = true;
    }

    currentStep++;
    onProgress?.({ phase: 'pass1', segment: i, totalSegments: n, status: 'done', currentStep, totalSteps });

    // Pass 2: Visual
    onProgress?.({ phase: 'pass2', segment: i, totalSegments: n, status: 'running', totalSteps });

    let pass2: Pass2Result | null = null;
    const pass2Attempt = await withRetry(
      () =>
        rateLimiter.execute(
          () =>
            runVisual({
              client,
              fileUri,
              mimeType,
              segment,
              model,
              resolution,
              pass1Transcript: pass1 ?? undefined,
              lang,
            }),
          { onWait },
        ),
      `segment ${i} pass2`,
    );

    if (pass2Attempt.error !== null) {
      log.warn(pass2Attempt.error);
      errors.push(pass2Attempt.error);
    } else {
      pass2 = pass2Attempt.result;
      pass2RanOnce = true;
    }

    currentStep++;
    onProgress?.({ phase: 'pass2', segment: i, totalSegments: n, status: 'done', currentStep, totalSteps });

    // Pass 3c: Chat extraction with link consensus (per segment)
    let pass3c: ChatExtraction | null | undefined;
    if (strategy.passes.includes('chat')) {
      onProgress?.({ phase: 'pass3c', segment: i, totalSegments: n, status: 'running', totalSteps });

      const linkConsensusResult = await runLinkConsensus({
        config: { runs: linkConsensusRuns, minAgreement: 2 },
        runFn: () =>
          rateLimiter.execute(
            () =>
              runChatExtraction({
                client,
                fileUri,
                mimeType,
                segment,
                model: MODELS.flash,
                resolution,
                pass2Result: pass2 ?? undefined,
                lang,
              }),
            { onWait },
          ),
        onProgress: (run, total) => {
          currentStep++;
          onProgress?.({ phase: 'pass3c', segment: i, totalSegments: n, status: run < total ? 'running' : 'done', currentStep, totalSteps });
        },
      });

      if (linkConsensusResult.runsCompleted === 0) {
        const errMsg = `segment ${i} pass3c: all link consensus runs failed`;
        log.warn(errMsg);
        errors.push(errMsg);
        pass3c = null;
      } else {
        pass3c = linkConsensusResult.merged;
        pass3cRanOnce = true;
      }
    }

    // Pass 3d: Implicit signals (per segment)
    let pass3d: ImplicitSignals | null | undefined;
    if (strategy.passes.includes('implicit')) {
      onProgress?.({ phase: 'pass3d', segment: i, totalSegments: n, status: 'running', totalSteps });
      const pass3dAttempt = await withRetry(
        () =>
          rateLimiter.execute(
            () =>
              runImplicitSignals({
                client,
                fileUri,
                mimeType,
                segment,
                model: MODELS.flash,
                resolution,
                pass1Result: pass1 ?? undefined,
                pass2Result: pass2 ?? undefined,
                lang,
              }),
            { onWait },
          ),
        `segment ${i} pass3d`,
      );
      if (pass3dAttempt.error !== null) {
        log.warn(pass3dAttempt.error);
        errors.push(pass3dAttempt.error);
        pass3d = null;
      } else {
        pass3d = pass3dAttempt.result;
        pass3dRanOnce = true;
      }
      currentStep++;
      onProgress?.({ phase: 'pass3d', segment: i, totalSegments: n, status: 'done', currentStep, totalSteps });
    }

    results.push({ index: segment.index, pass1, pass2, pass3c, pass3d });
  }

  // Build passesRun dynamically
  if (pass1RanOnce) passesRun.push('pass1');
  if (pass2RanOnce) passesRun.push('pass2');
  if (pass3cRanOnce) passesRun.push('pass3c');
  if (pass3dRanOnce) passesRun.push('pass3d');

  // If shutting down, skip post-segment passes and return partial results
  if (wasInterrupted) {
    if (strategy.passes.includes('code')) interruptedPasses.push('pass3a');
    if (strategy.passes.includes('people')) interruptedPasses.push('pass3b');
    if (strategy.passes.includes('synthesis')) interruptedPasses.push('synthesis');
    return {
      segments: results,
      passesRun,
      errors,
      videoProfile,
      strategy,
      synthesisResult: undefined,
      peopleExtraction: null,
      codeReconstruction: null,
      uncertainCodeFiles: undefined,
      interrupted: interruptedPasses,
    };
  }

  // Compile segment results for whole-video passes
  const pass1Results = results.map(r => r.pass1);
  const pass2Results = results.map(r => r.pass2);

  // Pass 3b: People extraction (once, whole video)
  let peopleExtraction: PeopleExtraction | null = null;
  if (strategy.passes.includes('people')) {
    onProgress?.({ phase: 'pass3b', segment: 0, totalSegments: 1, status: 'running', totalSteps });
    const pass3bAttempt = await withRetry(
      () =>
        rateLimiter.execute(
          () =>
            runPeopleExtraction({
              client,
              fileUri,
              mimeType,
              model: MODELS.flash,
              pass1Results,
              lang,
            }),
          { onWait },
        ),
      'pass3b',
    );
    if (pass3bAttempt.error !== null) {
      log.warn(pass3bAttempt.error);
      errors.push(pass3bAttempt.error);
    } else {
      peopleExtraction = pass3bAttempt.result;
    }
    currentStep++;
    onProgress?.({ phase: 'pass3b', segment: 0, totalSegments: 1, status: 'done', currentStep, totalSteps });
    if (peopleExtraction !== null) passesRun.push('pass3b');
  }

  // Pass 3a: Code reconstruction via consensus (3 runs + validation)
  let codeReconstruction: CodeReconstruction | null = null;
  let uncertainCodeFiles: string[] | undefined;
  if (strategy.passes.includes('code')) {
    const consensusConfig = { runs: 3, minAgreement: 2 };

    const consensusResult = await runCodeConsensus({
      config: consensusConfig,
      runFn: () =>
        rateLimiter.execute(
          () =>
            runCodeReconstruction({
              client,
              fileUri,
              mimeType,
              duration,
              model: MODELS.pro,
              resolution,
              pass1Results,
              pass2Results,
              lang,
            }),
          { onWait },
        ),
      pass2Results,
      onProgress: (run, total) => {
        // onProgress fires after each run completes (run = 1-based index of completed run)
        onProgress?.({ phase: 'pass3a', segment: run - 1, totalSegments: total, status: 'running', totalSteps });
        currentStep++;
        onProgress?.({ phase: 'pass3a', segment: run - 1, totalSegments: total, status: 'done', currentStep, totalSteps });
      },
    });

    // Suppress the old single done event (already emitted per-run above)

    if (consensusResult.runsCompleted === 0) {
      const errMsg = 'pass3a: all consensus runs failed';
      log.warn(errMsg);
      errors.push(errMsg);
    } else {
      const validationResult = validateCodeReconstruction({
        consensusResult,
        pass2Results,
      });

      const allFiles = [...validationResult.confirmed, ...validationResult.uncertain];

      if (allFiles.length > 0) {
        codeReconstruction = {
          files: allFiles,
          dependencies_mentioned: consensusResult.mergedDependencies,
          build_commands: consensusResult.mergedBuildCommands,
        };
        uncertainCodeFiles = validationResult.uncertain.map(f => f.filename);
      }

    }

    if (codeReconstruction !== null) passesRun.push('pass3a');
  }

  // Synthesis (last)
  let synthesisResult: SynthesisResult | undefined;
  if (strategy.passes.includes('synthesis')) {
    onProgress?.({ phase: 'synthesis', segment: 0, totalSegments: 1, status: 'running', totalSteps });
    const synthAttempt = await withRetry(
      () =>
        rateLimiter.execute(
          () =>
            runSynthesis({
              client,
              model: MODELS.pro,
              segmentResults: results,
              videoProfile,
              peopleExtraction,
              codeReconstruction,
              context: config.context,
              lang,
            }),
          { onWait },
        ),
      'synthesis',
    );
    if (synthAttempt.error !== null) {
      log.warn(synthAttempt.error);
      errors.push(synthAttempt.error);
    } else {
      synthesisResult = synthAttempt.result ?? undefined;
    }
    currentStep++;
    onProgress?.({ phase: 'synthesis', segment: 0, totalSegments: 1, status: 'done', currentStep, totalSteps });
    if (synthesisResult !== undefined) passesRun.push('synthesis');
  }

  return {
    segments: results,
    passesRun,
    errors,
    videoProfile,
    strategy,
    synthesisResult,
    peopleExtraction,
    codeReconstruction,
    uncertainCodeFiles,
    interrupted: undefined,
  };
}
