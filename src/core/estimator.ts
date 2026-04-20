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
