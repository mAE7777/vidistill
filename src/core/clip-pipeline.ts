import { log } from '@clack/prompts';
import type { MediaResolution } from '@google/genai';
import { runSceneAnalysis } from '../passes/scene-analysis.js';
import { determineStrategy } from './strategy.js';
import { createSegmentPlan } from './segmenter.js';
import { MODELS } from '../gemini/models.js';
import { TRANSCRIPT_CONSENSUS_RUNS, LINK_CONSENSUS_RUNS } from './estimator.js';
import { processOneSegment, runWholeVideoPasses, DEFAULT_PROFILE } from './pipeline.js';
import { normalizePipelineTimestamps, normalizeSegmentResultTimestamps } from './timestamps.js';
import { parseTimestamp, formatTime } from '../lib/utils.js';
import { CLIP_CONCURRENCY } from './splitter.js';
import type { GeminiClient, UploadedFile } from '../gemini/client.js';
import type { RateLimiter } from '../gemini/rate-limiter.js';
import type {
  PipelineResult,
  SegmentResult,
  VideoProfile,
  PassStrategy,
  ProgressStatus,
  Segment,
} from '../types/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface UploadedClip {
  index: number;
  fileUri: string;
  mimeType: string;
  uploadedFileName: string;
  /** Start time of this clip in the original video (seconds). */
  globalStartTime: number;
  /** End time of this clip in the original video (seconds). */
  globalEndTime: number;
  /** Duration of this clip (seconds). */
  clipDuration: number;
  /** Overlap with next clip (seconds). 0 for last clip. */
  overlapDuration: number;
}

export interface ClipPipelineConfig {
  client: GeminiClient;
  clips: UploadedClip[];
  totalDuration: number;
  model: string;
  rateLimiter: RateLimiter;
  concurrency?: number;
  context?: string;
  lang?: string;
  channelAuthor?: string;
  quick?: boolean;
  onProgress?: (status: ProgressStatus) => void;
  onWait?: (delayMs: number) => void;
  isShuttingDown?: () => boolean;
  onPass0Complete?: (profile: VideoProfile, strategy: PassStrategy, clipCount: number) => Promise<boolean>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [2000, 4000, 8000];

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<{ result: T | null; error: string | null }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      return { result: await fn(), error: null };
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

/** Add a time offset (seconds) to a timestamp string like "12:34" or "01:23:45". */
export function offsetTimestamp(ts: string, offsetSec: number): string {
  if (offsetSec === 0) return ts;
  const seconds = parseTimestamp(ts) + offsetSec;
  return formatTime(Math.max(0, seconds));
}

/** Offset a time_range string like "00:00:00-00:10:00". */
function offsetTimeRange(range: string, offsetSec: number): string {
  if (offsetSec === 0) return range;
  const parts = range.split('-').map(s => s.trim());
  if (parts.length !== 2) return range;
  return `${offsetTimestamp(parts[0], offsetSec)}-${offsetTimestamp(parts[1], offsetSec)}`;
}

/**
 * Shift all timestamps in a SegmentResult by offsetSec seconds.
 * Returns a deep clone — does not mutate the original.
 */
export function offsetSegmentResult(result: SegmentResult, offsetSec: number, globalIndex: number): SegmentResult {
  if (offsetSec === 0 && globalIndex === result.index) {
    return JSON.parse(JSON.stringify(result)) as SegmentResult;
  }

  const r: SegmentResult = JSON.parse(JSON.stringify(result)) as SegmentResult;
  r.index = globalIndex;

  if (r.pass1) {
    r.pass1.segment_index = globalIndex;
    if (r.pass1.time_range) r.pass1.time_range = offsetTimeRange(r.pass1.time_range, offsetSec);
    for (const e of r.pass1.transcript_entries ?? []) {
      e.timestamp = offsetTimestamp(e.timestamp, offsetSec);
    }
  }

  if (r.pass2) {
    r.pass2.segment_index = globalIndex;
    if (r.pass2.time_range) r.pass2.time_range = offsetTimeRange(r.pass2.time_range, offsetSec);
    for (const b of r.pass2.code_blocks ?? []) {
      b.timestamp = offsetTimestamp(b.timestamp, offsetSec);
      if (b.timestamp_end) b.timestamp_end = offsetTimestamp(b.timestamp_end, offsetSec);
    }
    for (const v of r.pass2.visual_notes ?? []) {
      v.timestamp = offsetTimestamp(v.timestamp, offsetSec);
    }
    for (const s of r.pass2.screen_timeline ?? []) {
      s.timestamp = offsetTimestamp(s.timestamp, offsetSec);
    }
    for (const region of r.pass2.visual_regions ?? []) {
      region.timestamp = offsetTimestamp(region.timestamp, offsetSec);
    }
  }

  if (r.pass3c) {
    for (const m of r.pass3c.messages ?? []) m.timestamp = offsetTimestamp(m.timestamp, offsetSec);
    for (const l of r.pass3c.links ?? []) l.timestamp = offsetTimestamp(l.timestamp, offsetSec);
  }

  if (r.pass3d) {
    for (const s of r.pass3d.emotional_shifts ?? []) s.timestamp = offsetTimestamp(s.timestamp, offsetSec);
    for (const t of r.pass3d.tasks_assigned ?? []) t.timestamp = offsetTimestamp(t.timestamp, offsetSec);
    for (const p of r.pass3d.emphasis_patterns ?? []) {
      p.timestamps = (p.timestamps ?? []).map(ts => offsetTimestamp(ts, offsetSec));
    }
  }

  return r;
}

/**
 * Per-result metadata for overlap deduplication.
 * Built during assembly so it stays co-indexed with results[],
 * even when clips produce multiple segments.
 */
export interface ResultOverlapInfo {
  clipIndex: number;
  /** True if this is the last segment of this clip. Overlap trimming only applies to last segments. */
  isLastSegmentOfClip: boolean;
  /** Global timestamp (seconds) where the next clip starts. Entries >= this are trimmed. Undefined if no next clip. */
  nextClipStartTime?: number;
}

/**
 * Remove entries from the overlap zone of each clip.
 * Strategy: for the overlap between clip N and clip N+1, keep clip N+1's data
 * (fresher transcription of that time window) and trim clip N's tail.
 */
export function deduplicateOverlaps(
  results: SegmentResult[],
  overlapInfos: ResultOverlapInfo[],
): void {
  for (let i = 0; i < results.length; i++) {
    const info = overlapInfos[i];
    if (!info.isLastSegmentOfClip || info.nextClipStartTime == null) continue;

    const cutoff = info.nextClipStartTime;
    const r = results[i];
    if (r.pass1) {
      r.pass1.transcript_entries = (r.pass1.transcript_entries ?? []).filter(
        e => parseTimestamp(e.timestamp) < cutoff,
      );
    }
    if (r.pass2) {
      r.pass2.code_blocks = (r.pass2.code_blocks ?? []).filter(b => parseTimestamp(b.timestamp) < cutoff);
      r.pass2.visual_notes = (r.pass2.visual_notes ?? []).filter(v => parseTimestamp(v.timestamp) < cutoff);
      r.pass2.screen_timeline = (r.pass2.screen_timeline ?? []).filter(s => parseTimestamp(s.timestamp) < cutoff);
      r.pass2.visual_regions = (r.pass2.visual_regions ?? []).filter(region => parseTimestamp(region.timestamp) < cutoff);
    }
    if (r.pass3c) {
      r.pass3c.messages = (r.pass3c.messages ?? []).filter(m => parseTimestamp(m.timestamp) < cutoff);
      r.pass3c.links = (r.pass3c.links ?? []).filter(l => parseTimestamp(l.timestamp) < cutoff);
    }
    if (r.pass3d) {
      r.pass3d.emotional_shifts = (r.pass3d.emotional_shifts ?? []).filter(s => parseTimestamp(s.timestamp) < cutoff);
      r.pass3d.tasks_assigned = (r.pass3d.tasks_assigned ?? []).filter(t => parseTimestamp(t.timestamp) < cutoff);
      for (const p of r.pass3d.emphasis_patterns ?? []) {
        p.timestamps = (p.timestamps ?? []).filter(ts => parseTimestamp(ts) < cutoff);
      }
      r.pass3d.emphasis_patterns = (r.pass3d.emphasis_patterns ?? []).filter(p => (p.timestamps ?? []).length > 0);
    }
  }
}

// ── Concurrent worker pool ───────────────────────────────────────────────────

async function runConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  isShuttingDown?: () => boolean,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let nextIdx = 0;

  const takeNext = (): number | null => {
    if (isShuttingDown?.() || nextIdx >= items.length) return null;
    return nextIdx++;
  };

  const worker = async (): Promise<void> => {
    while (true) {
      const idx = takeNext();
      if (idx === null) break;
      results[idx] = await fn(items[idx], idx);
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);

  return results;
}

// ── Main clip pipeline ───────────────────────────────────────────────────────

export async function runClipPipeline(config: ClipPipelineConfig): Promise<PipelineResult> {
  const {
    client, clips, totalDuration, model, rateLimiter,
    concurrency = CLIP_CONCURRENCY,
    context, lang, channelAuthor, quick, onProgress, onWait, isShuttingDown,
  } = config;

  const errors: string[] = [];
  const passesRun: string[] = [];

  // ── Pass 0: Scene analysis on first clip ────────────────────────────────
  let videoProfile: VideoProfile;
  let strategy: PassStrategy;

  onProgress?.({ phase: 'pass0', segment: 0, totalSegments: clips.length, status: 'running' });

  const firstClip = clips[0];
  const pass0Attempt = await withRetry(
    () => rateLimiter.execute(
      () => runSceneAnalysis({ client, fileUri: firstClip.fileUri, mimeType: firstClip.mimeType, duration: totalDuration, model, lang }),
      { onWait },
    ),
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
  if (quick) {
    strategy = { ...strategy, passes: strategy.passes.filter(p => p !== 'implicit' && p !== 'people') };
  }

  onProgress?.({ phase: 'pass0', segment: 0, totalSegments: clips.length, status: 'done' });

  // ── Cost confirmation callback ──────────────────────────────────────────
  if (config.onPass0Complete != null) {
    const proceed = await config.onPass0Complete(videoProfile, strategy, clips.length);
    if (!proceed) {
      return {
        segments: [],
        passesRun: [],
        errors,
        dedupRemovalCount: 0,
        videoProfile,
        strategy,
        synthesisResult: undefined,
        peopleExtraction: null,
        codeReconstruction: null,
        uncertainCodeFiles: undefined,
        interrupted: undefined,
        tokenUsage: client.getTokenUsage(),
        apiCallCount: client.getApiCallCount(),
      };
    }
  }

  // ── Build segment plans per clip ────────────────────────────────────────
  const transcriptConsensusRuns = quick ? 1 : TRANSCRIPT_CONSENSUS_RUNS;
  const linkConsensusRuns = LINK_CONSENSUS_RUNS;

  // Each clip gets its own segment plan (usually 1 segment for a 20-min clip)
  const clipSegmentPlans = clips.map(clip => {
    const plan = createSegmentPlan(clip.clipDuration, {
      segmentMinutes: strategy.segmentMinutes,
      resolution: strategy.resolution,
    });
    return { clip, segments: plan.segments, resolution: plan.resolution };
  });

  const totalSegmentCount = clipSegmentPlans.reduce((sum, p) => sum + p.segments.length, 0);

  log.info(`Processing ${clips.length} clips (${totalSegmentCount} segments) with concurrency ${Math.min(concurrency, clips.length)}`);

  // ── Process clips in parallel ───────────────────────────────────────────
  let wasInterrupted = false;
  const interruptedPasses: string[] = [];

  let totalConsensusAttempts = 0;
  let totalConsensusSuccesses = 0;
  let pass1RanOnce = false;
  let pass2RanOnce = false;
  let pass3cRanOnce = false;
  let pass3dRanOnce = false;
  let completedClips = 0;

  interface ClipOutput {
    clipIndex: number;
    segmentResults: SegmentResult[];
    errors: string[];
  }

  const clipOutputs = await runConcurrent<typeof clipSegmentPlans[0], ClipOutput>(
    clipSegmentPlans,
    concurrency,
    async (clipPlan, _clipArrayIdx) => {
      const { clip, segments, resolution } = clipPlan;
      const clipResults: SegmentResult[] = [];
      let clipInterrupted = false;

      for (const segment of segments) {
        if (isShuttingDown?.()) {
          wasInterrupted = true;
          clipInterrupted = true;
          break;
        }

        const segOutput = await processOneSegment({
          client,
          fileUri: clip.fileUri,
          mimeType: clip.mimeType,
          segment,
          model,
          resolution,
          strategy,
          rateLimiter,
          transcriptConsensusRuns,
          linkConsensusRuns,
          lang,
          channelAuthor,
          onWait,
        });

        totalConsensusAttempts += segOutput.consensusAttempts;
        totalConsensusSuccesses += segOutput.consensusSuccesses;
        if (segOutput.pass1Ran) pass1RanOnce = true;
        if (segOutput.pass2Ran) pass2RanOnce = true;
        if (segOutput.pass3cRan) pass3cRanOnce = true;
        if (segOutput.pass3dRan) pass3dRanOnce = true;
        errors.push(...segOutput.errors);

        clipResults.push(segOutput.result);
      }

      if (!clipInterrupted) {
        completedClips++;
        onProgress?.({
          phase: 'clips',
          segment: completedClips,
          totalSegments: clips.length,
          status: 'done',
        });
      }

      return { clipIndex: clip.index, segmentResults: clipResults, errors: [] };
    },
    isShuttingDown,
  );

  // ── Assemble results with timestamp offsets ─────────────────────────────
  // Flatten clip results into a single ordered array with global indices and offsets.
  // Build per-result overlap info for dedup (handles multi-segment clips correctly).
  let globalSegmentIndex = 0;
  const allResults: SegmentResult[] = [];
  const overlapInfos: ResultOverlapInfo[] = [];

  for (let ci = 0; ci < clips.length; ci++) {
    const clipOutput = clipOutputs[ci];
    if (clipOutput == null) {
      // Clip was skipped (shutdown)
      wasInterrupted = true;
      interruptedPasses.push(`clip ${ci} (all passes)`);
      continue;
    }

    const clip = clips[ci];
    const segCount = clipOutput.segmentResults.length;
    const nextClipStart = ci + 1 < clips.length ? clips[ci + 1].globalStartTime : undefined;

    for (let si = 0; si < segCount; si++) {
      const offsetResult = offsetSegmentResult(clipOutput.segmentResults[si], clip.globalStartTime, globalSegmentIndex);
      allResults.push(offsetResult);
      overlapInfos.push({
        clipIndex: ci,
        isLastSegmentOfClip: si === segCount - 1,
        nextClipStartTime: clip.overlapDuration > 0 ? nextClipStart : undefined,
      });
      globalSegmentIndex++;
    }
  }

  // Build passesRun
  if (pass1RanOnce) passesRun.push('pass1');
  if (pass2RanOnce) passesRun.push('pass2');
  if (pass3cRanOnce) passesRun.push('pass3c');
  if (pass3dRanOnce) passesRun.push('pass3d');

  for (const result of allResults) {
    normalizeSegmentResultTimestamps(result, totalDuration);
  }

  if (wasInterrupted) {
    if (strategy.passes.includes('code')) interruptedPasses.push('pass3a');
    if (strategy.passes.includes('people')) interruptedPasses.push('pass3b');
    if (strategy.passes.includes('synthesis')) interruptedPasses.push('synthesis');
    const partialResult: PipelineResult = {
      segments: allResults,
      passesRun,
      errors,
      videoProfile,
      strategy,
      synthesisResult: undefined,
      peopleExtraction: null,
      codeReconstruction: null,
      uncertainCodeFiles: undefined,
      interrupted: interruptedPasses,
      tokenUsage: client.getTokenUsage(),
      apiCallCount: client.getApiCallCount(),
      dedupRemovalCount: 0,
      ...(totalConsensusAttempts > 0 ? { consensusAgreementRate: totalConsensusSuccesses / totalConsensusAttempts } : {}),
    };
    return normalizePipelineTimestamps(partialResult, totalDuration);
  }

  // ── Deduplicate overlap zones ───────────────────────────────────────────
  deduplicateOverlaps(allResults, overlapInfos);

  // ── Whole-video passes ──────────────────────────────────────────────────
  onProgress?.({ phase: 'assembly', segment: 0, totalSegments: 1, status: 'running' });

  const wholeVideoOutput = await runWholeVideoPasses({
    client,
    fileUri: firstClip.fileUri,  // first clip for people/code visual reference
    mimeType: firstClip.mimeType,
    duration: totalDuration,
    results: allResults,
    strategy,
    videoProfile,
    rateLimiter,
    context,
    lang,
    quick,
    onWait,
  });

  errors.push(...wholeVideoOutput.errors);
  passesRun.push(...wholeVideoOutput.passesRun);
  totalConsensusAttempts += wholeVideoOutput.consensusAttempts;
  totalConsensusSuccesses += wholeVideoOutput.consensusSuccesses;

  onProgress?.({ phase: 'synthesis', segment: 0, totalSegments: 1, status: 'done' });

  const finalResult: PipelineResult = {
    segments: allResults,
    passesRun,
    errors,
    videoProfile,
    strategy,
    synthesisResult: wholeVideoOutput.synthesisResult,
    peopleExtraction: wholeVideoOutput.peopleExtraction,
    codeReconstruction: wholeVideoOutput.codeReconstruction,
    uncertainCodeFiles: wholeVideoOutput.uncertainCodeFiles,
    interrupted: undefined,
    tokenUsage: client.getTokenUsage(),
    apiCallCount: client.getApiCallCount(),
    dedupRemovalCount: wholeVideoOutput.dedupRemovalCount,
    ...(totalConsensusAttempts > 0 ? { consensusAgreementRate: totalConsensusSuccesses / totalConsensusAttempts } : {}),
  };
  return normalizePipelineTimestamps(finalResult, totalDuration);
}
