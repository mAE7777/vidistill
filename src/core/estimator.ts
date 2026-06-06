import type { PassStrategy } from '../types/index.js';
import type { CostEstimate } from '../types/index.js';

export const TRANSCRIPT_CONSENSUS_RUNS = 3;
export const LINK_CONSENSUS_RUNS = 3;
export const CODE_CONSENSUS_RUNS = 3;

export function estimateApiCalls(strategy: PassStrategy, segmentCount: number): CostEstimate {
  const callsPerSegment =
    (TRANSCRIPT_CONSENSUS_RUNS * 2) + 1 +
    (strategy.passes.includes('chat') ? LINK_CONSENSUS_RUNS : 0) +
    (strategy.passes.includes('implicit') ? 1 : 0);

  const postSegmentCalls =
    (strategy.passes.includes('people') ? 1 : 0) +
    (strategy.passes.includes('code') ? CODE_CONSENSUS_RUNS : 0) +
    (strategy.passes.includes('synthesis') ? 1 : 0) +
    1 + // pass0
    1;  // dedup

  const totalCalls = segmentCount * callsPerSegment + postSegmentCalls;
  const estimatedMinutes: [number, number] = [
    totalCalls * 3 / 60,
    totalCalls * 8 / 60,
  ];

  return { totalCalls, estimatedMinutes };
}

/**
 * Estimate API calls for the clip pipeline.
 * Each clip is treated as ~1 segment internally, plus whole-video passes run once.
 */
export function estimateClipApiCalls(strategy: PassStrategy, clipCount: number): CostEstimate {
  // Per-clip calls (each clip ≈ 1 segment)
  const callsPerClip =
    (TRANSCRIPT_CONSENSUS_RUNS * 2) + 1 +
    (strategy.passes.includes('chat') ? LINK_CONSENSUS_RUNS : 0) +
    (strategy.passes.includes('implicit') ? 1 : 0);

  // Whole-video passes (run once after all clips)
  const postClipCalls =
    (strategy.passes.includes('people') ? 1 : 0) +
    (strategy.passes.includes('code') ? CODE_CONSENSUS_RUNS : 0) +
    (strategy.passes.includes('synthesis') ? 1 : 0) +
    1 + // pass0
    1;  // dedup

  const totalCalls = clipCount * callsPerClip + postClipCalls;

  // With parallel processing, wall-clock time is reduced by concurrency factor
  const concurrency = Math.min(4, clipCount);
  const parallelFactor = clipCount / concurrency;
  const sequentialEquivalentCalls = parallelFactor * callsPerClip + postClipCalls;

  const estimatedMinutes: [number, number] = [
    sequentialEquivalentCalls * 3 / 60,
    sequentialEquivalentCalls * 8 / 60,
  ];

  return { totalCalls, estimatedMinutes };
}
