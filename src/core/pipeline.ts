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
  const { client, fileUri, mimeType, duration, model, rateLimiter, onProgress, onWait, isShuttingDown } = config;

  const errors: string[] = [];
  const passesRun: string[] = [];

  // Pass 0: Scene analysis
  onProgress?.({ phase: 'pass0', segment: 0, totalSegments: 1, status: 'running' });

  let videoProfile: VideoProfile;
  let strategy: PassStrategy;

  const pass0Attempt = await withRetry(
    () => rateLimiter.execute(() => runSceneAnalysis({ client, fileUri, mimeType, duration, model }), { onWait }),
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

  log.info(`Video type: ${videoProfile.type}`);
  log.info(`Strategy: ${strategy.passes.join(' → ')}`);

  // Build segment plan from strategy
  const plan = createSegmentPlan(duration, {
    segmentMinutes: strategy.segmentMinutes,
    resolution: strategy.resolution,
  });
  const segments = plan.segments;
  const resolution = plan.resolution;

  const results: SegmentResult[] = [];
  const n = segments.length;

  let pass1RanOnce = false;
  let pass2RanOnce = false;
  let pass3aRanOnce = false;
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
    onProgress?.({ phase: 'pass1', segment: i, totalSegments: n, status: 'running' });

    let pass1: Pass1Result | null = null;
    const pass1Attempt = await withRetry(
      () => rateLimiter.execute(() => runTranscript({ client, fileUri, mimeType, segment, model, resolution }), { onWait }),
      `segment ${i} pass1`,
    );

    if (pass1Attempt.error !== null) {
      log.warn(pass1Attempt.error);
      errors.push(pass1Attempt.error);
    } else {
      pass1 = pass1Attempt.result;
      pass1RanOnce = true;
    }

    onProgress?.({ phase: 'pass1', segment: i, totalSegments: n, status: 'done' });

    // Pass 2: Visual
    onProgress?.({ phase: 'pass2', segment: i, totalSegments: n, status: 'running' });

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

    onProgress?.({ phase: 'pass2', segment: i, totalSegments: n, status: 'done' });

    // Pass 3a: Code reconstruction (per segment)
    let pass3a: CodeReconstruction | null | undefined;
    if (strategy.passes.includes('code')) {
      onProgress?.({ phase: 'pass3a', segment: i, totalSegments: n, status: 'running' });
      const pass3aAttempt = await withRetry(
        () =>
          rateLimiter.execute(
            () =>
              runCodeReconstruction({
                client,
                fileUri,
                mimeType,
                segment,
                model: MODELS[0].id,
                resolution,
                pass1Result: pass1 ?? undefined,
                pass2Result: pass2 ?? undefined,
              }),
            { onWait },
          ),
        `segment ${i} pass3a`,
      );
      if (pass3aAttempt.error !== null) {
        log.warn(pass3aAttempt.error);
        errors.push(pass3aAttempt.error);
        pass3a = null;
      } else {
        pass3a = pass3aAttempt.result;
        pass3aRanOnce = true;
      }
      onProgress?.({ phase: 'pass3a', segment: i, totalSegments: n, status: 'done' });
    }

    // Pass 3c: Chat extraction (per segment)
    let pass3c: ChatExtraction | null | undefined;
    if (strategy.passes.includes('chat')) {
      onProgress?.({ phase: 'pass3c', segment: i, totalSegments: n, status: 'running' });
      const pass3cAttempt = await withRetry(
        () =>
          rateLimiter.execute(
            () =>
              runChatExtraction({
                client,
                fileUri,
                mimeType,
                segment,
                model: MODELS[1].id,
                resolution,
                pass2Result: pass2 ?? undefined,
              }),
            { onWait },
          ),
        `segment ${i} pass3c`,
      );
      if (pass3cAttempt.error !== null) {
        log.warn(pass3cAttempt.error);
        errors.push(pass3cAttempt.error);
        pass3c = null;
      } else {
        pass3c = pass3cAttempt.result;
        pass3cRanOnce = true;
      }
      onProgress?.({ phase: 'pass3c', segment: i, totalSegments: n, status: 'done' });
    }

    // Pass 3d: Implicit signals (per segment)
    let pass3d: ImplicitSignals | null | undefined;
    if (strategy.passes.includes('implicit')) {
      onProgress?.({ phase: 'pass3d', segment: i, totalSegments: n, status: 'running' });
      const pass3dAttempt = await withRetry(
        () =>
          rateLimiter.execute(
            () =>
              runImplicitSignals({
                client,
                fileUri,
                mimeType,
                segment,
                model: MODELS[0].id,
                resolution,
                pass1Result: pass1 ?? undefined,
                pass2Result: pass2 ?? undefined,
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
      onProgress?.({ phase: 'pass3d', segment: i, totalSegments: n, status: 'done' });
    }

    results.push({ index: segment.index, pass1, pass2, pass3a, pass3c, pass3d });
  }

  // Build passesRun dynamically
  if (pass1RanOnce) passesRun.push('pass1');
  if (pass2RanOnce) passesRun.push('pass2');
  if (pass3aRanOnce) passesRun.push('pass3a');
  if (pass3cRanOnce) passesRun.push('pass3c');
  if (pass3dRanOnce) passesRun.push('pass3d');

  // If shutting down, skip post-segment passes and return partial results
  if (wasInterrupted) {
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
      interrupted: interruptedPasses,
    };
  }

  // Pass 3b: People extraction (once, whole video)
  let peopleExtraction: PeopleExtraction | null = null;
  if (strategy.passes.includes('people')) {
    onProgress?.({ phase: 'pass3b', segment: 0, totalSegments: 1, status: 'running' });
    const pass1Results = results.map(r => r.pass1);
    const pass3bAttempt = await withRetry(
      () =>
        rateLimiter.execute(
          () =>
            runPeopleExtraction({
              client,
              fileUri,
              mimeType,
              model: MODELS[0].id,
              pass1Results,
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
    onProgress?.({ phase: 'pass3b', segment: 0, totalSegments: 1, status: 'done' });
    if (peopleExtraction !== null) passesRun.push('pass3b');
  }

  // Synthesis (last)
  let synthesisResult: SynthesisResult | undefined;
  if (strategy.passes.includes('synthesis')) {
    onProgress?.({ phase: 'synthesis', segment: 0, totalSegments: 1, status: 'running' });
    const synthAttempt = await withRetry(
      () =>
        rateLimiter.execute(
          () =>
            runSynthesis({
              client,
              model: MODELS[1].id,
              segmentResults: results,
              videoProfile,
              peopleExtraction,
              context: config.context,
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
    onProgress?.({ phase: 'synthesis', segment: 0, totalSegments: 1, status: 'done' });
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
    interrupted: undefined,
  };
}
