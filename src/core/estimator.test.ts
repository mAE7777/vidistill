import { describe, it, expect } from 'vitest';
import { estimateApiCalls, TRANSCRIPT_CONSENSUS_RUNS, LINK_CONSENSUS_RUNS, CODE_CONSENSUS_RUNS } from './estimator.js';
import type { PassStrategy } from '../types/index.js';

function makeStrategy(passes: string[]): PassStrategy {
  return { passes, resolution: 'medium', segmentMinutes: 10 };
}

describe('estimateApiCalls', () => {
  it('coding video: 3 segments, transcript+visual+code+synthesis', () => {
    // callsPerSegment = (3*2)+1+0+0 = 7
    // postSegmentCalls = 0+3+1+1+1 = 6
    // totalCalls = 3*7+6 = 27
    const strategy = makeStrategy(['transcript', 'visual', 'code', 'synthesis']);
    const result = estimateApiCalls(strategy, 3);
    expect(result.totalCalls).toBe(27);
    expect(result.estimatedMinutes[0]).toBeCloseTo(27 * 3 / 60);
    expect(result.estimatedMinutes[1]).toBeCloseTo(27 * 8 / 60);
  });

  it('meeting video: chat+implicit+people (1 segment)', () => {
    // callsPerSegment = (3*2)+1+3(chat)+1(implicit) = 11
    // postSegmentCalls = 1(people)+0+1(synthesis)+1(pass0)+1(dedup) = 4
    // totalCalls = 1*11+4 = 15
    const strategy = makeStrategy(['transcript', 'visual', 'people', 'chat', 'implicit', 'synthesis']);
    const result = estimateApiCalls(strategy, 1);
    expect(result.totalCalls).toBe(15);
  });

  it('audio-only video: transcript+people+implicit+synthesis (2 segments)', () => {
    // callsPerSegment = (3*2)+1+0+1(implicit) = 8
    // postSegmentCalls = 1(people)+0+1(synthesis)+1(pass0)+1(dedup) = 4
    // totalCalls = 2*8+4 = 20
    const strategy = makeStrategy(['transcript', 'people', 'implicit', 'synthesis']);
    const result = estimateApiCalls(strategy, 2);
    expect(result.totalCalls).toBe(20);
  });

  it('single-segment video: transcript+visual only', () => {
    // callsPerSegment = (3*2)+1 = 7
    // postSegmentCalls = 0+0+0+1(pass0)+1(dedup) = 2
    // totalCalls = 1*7+2 = 9
    const strategy = makeStrategy(['transcript', 'visual']);
    const result = estimateApiCalls(strategy, 1);
    expect(result.totalCalls).toBe(9);
  });

  it('zero segments edge case', () => {
    // callsPerSegment = 7; postSegmentCalls = 2 (pass0+dedup only)
    // totalCalls = 0*7+2 = 2
    const strategy = makeStrategy(['transcript', 'visual']);
    const result = estimateApiCalls(strategy, 0);
    expect(result.totalCalls).toBe(2);
  });

  it('estimatedMinutes tuple has correct lower and upper bounds', () => {
    const strategy = makeStrategy(['transcript', 'visual', 'code', 'synthesis']);
    const result = estimateApiCalls(strategy, 3);
    const [low, high] = result.estimatedMinutes;
    expect(high).toBeGreaterThan(low);
    expect(low).toBeCloseTo(result.totalCalls * 3 / 60, 5);
    expect(high).toBeCloseTo(result.totalCalls * 8 / 60, 5);
  });

  it('constants are exported with correct values', () => {
    expect(TRANSCRIPT_CONSENSUS_RUNS).toBe(3);
    expect(LINK_CONSENSUS_RUNS).toBe(3);
    expect(CODE_CONSENSUS_RUNS).toBe(3);
  });

  it('full strategy (all passes) meeting video: 3 segments', () => {
    // callsPerSegment = (3*2)+1+3(chat)+1(implicit) = 11
    // postSegmentCalls = 1(people)+3(code)+1(synthesis)+1(pass0)+1(dedup) = 7
    // totalCalls = 3*11+7 = 40
    const strategy = makeStrategy(['transcript', 'visual', 'code', 'people', 'chat', 'implicit', 'synthesis']);
    const result = estimateApiCalls(strategy, 3);
    expect(result.totalCalls).toBe(40);
  });
});
