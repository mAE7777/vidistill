import { describe, it, expect } from 'vitest';
import {
  shouldSplitIntoClips,
  createClipPlan,
  CLIP_DURATION_SEC,
  CLIP_OVERLAP_SEC,
  CLIP_THRESHOLD_SEC,
} from './splitter.js';

describe('shouldSplitIntoClips', () => {
  it('returns false for short videos', () => {
    expect(shouldSplitIntoClips(600)).toBe(false);   // 10 min
    expect(shouldSplitIntoClips(1200)).toBe(false);  // 20 min
    expect(shouldSplitIntoClips(1500)).toBe(false);  // 25 min (= threshold)
  });

  it('returns true for videos longer than threshold', () => {
    expect(shouldSplitIntoClips(1501)).toBe(true);   // just over 25 min
    expect(shouldSplitIntoClips(3600)).toBe(true);   // 1 hour
    expect(shouldSplitIntoClips(10800)).toBe(true);  // 3 hours
  });

  it('returns false for invalid durations', () => {
    expect(shouldSplitIntoClips(NaN)).toBe(false);
    expect(shouldSplitIntoClips(Infinity)).toBe(false);
    expect(shouldSplitIntoClips(-1)).toBe(false);
    expect(shouldSplitIntoClips(0)).toBe(false);
  });
});

describe('createClipPlan', () => {
  it('returns empty array for zero or negative duration', () => {
    expect(createClipPlan(0)).toEqual([]);
    expect(createClipPlan(-100)).toEqual([]);
    expect(createClipPlan(NaN)).toEqual([]);
  });

  it('returns single clip for short video', () => {
    const plan = createClipPlan(600); // 10 min — shorter than clipDuration + overlap
    expect(plan).toHaveLength(1);
    expect(plan[0]).toEqual({
      index: 0,
      startTime: 0,
      endTime: 600,
      overlapDuration: 0,
    });
  });

  it('returns single clip when duration <= clipDuration + overlap', () => {
    const plan = createClipPlan(CLIP_DURATION_SEC + CLIP_OVERLAP_SEC);
    expect(plan).toHaveLength(1);
    expect(plan[0].overlapDuration).toBe(0);
  });

  it('splits a 1-hour video into 3 clips with overlap', () => {
    const plan = createClipPlan(3600); // 60 min
    expect(plan).toHaveLength(3);

    // Clip 0: [0, 1200+30] = [0, 1230]
    expect(plan[0]).toEqual({
      index: 0,
      startTime: 0,
      endTime: CLIP_DURATION_SEC + CLIP_OVERLAP_SEC,
      overlapDuration: CLIP_OVERLAP_SEC,
    });

    // Clip 1: [1200, 2400+30] = [1200, 2430]
    expect(plan[1]).toEqual({
      index: 1,
      startTime: CLIP_DURATION_SEC,
      endTime: 2 * CLIP_DURATION_SEC + CLIP_OVERLAP_SEC,
      overlapDuration: CLIP_OVERLAP_SEC,
    });

    // Clip 2: [2400, 3600] — last clip, no overlap
    expect(plan[2]).toEqual({
      index: 2,
      startTime: 2 * CLIP_DURATION_SEC,
      endTime: 3600,
      overlapDuration: 0,
    });
  });

  it('splits a 3-hour video into 9 clips', () => {
    const plan = createClipPlan(10800); // 180 min
    expect(plan).toHaveLength(9);

    // First clip has overlap
    expect(plan[0].overlapDuration).toBe(CLIP_OVERLAP_SEC);
    // Last clip has no overlap
    expect(plan[8].overlapDuration).toBe(0);
    expect(plan[8].endTime).toBe(10800);

    // All clips except last have overlap
    for (let i = 0; i < 8; i++) {
      expect(plan[i].overlapDuration).toBe(CLIP_OVERLAP_SEC);
    }
  });

  it('handles partial last clip correctly', () => {
    // 25 min = 1500s — one full 20min clip + a 5min tail
    const plan = createClipPlan(1500);
    expect(plan).toHaveLength(2);

    expect(plan[0]).toEqual({
      index: 0,
      startTime: 0,
      endTime: CLIP_DURATION_SEC + CLIP_OVERLAP_SEC,
      overlapDuration: CLIP_OVERLAP_SEC,
    });

    expect(plan[1]).toEqual({
      index: 1,
      startTime: CLIP_DURATION_SEC,
      endTime: 1500,
      overlapDuration: 0,
    });
  });

  it('respects custom clip duration and overlap', () => {
    const plan = createClipPlan(600, 300, 15); // 10min, 5min clips, 15s overlap
    expect(plan).toHaveLength(2);

    expect(plan[0]).toEqual({
      index: 0,
      startTime: 0,
      endTime: 315,
      overlapDuration: 15,
    });

    expect(plan[1]).toEqual({
      index: 1,
      startTime: 300,
      endTime: 600,
      overlapDuration: 0,
    });
  });

  it('clips never exceed total duration', () => {
    const plan = createClipPlan(1300); // 21:40 — just over one clip
    for (const clip of plan) {
      expect(clip.endTime).toBeLessThanOrEqual(1300);
    }
  });

  it('clip starts are monotonically increasing', () => {
    const plan = createClipPlan(7200);
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].startTime).toBeGreaterThan(plan[i - 1].startTime);
    }
  });

  it('consecutive clips overlap by exactly CLIP_OVERLAP_SEC', () => {
    const plan = createClipPlan(7200);
    for (let i = 0; i < plan.length - 1; i++) {
      const overlapRegion = plan[i].endTime - plan[i + 1].startTime;
      expect(overlapRegion).toBe(CLIP_OVERLAP_SEC);
    }
  });
});

describe('constants', () => {
  it('CLIP_DURATION_SEC is 20 minutes', () => {
    expect(CLIP_DURATION_SEC).toBe(20 * 60);
  });

  it('CLIP_OVERLAP_SEC is 30 seconds', () => {
    expect(CLIP_OVERLAP_SEC).toBe(30);
  });

  it('CLIP_THRESHOLD_SEC is 25 minutes', () => {
    expect(CLIP_THRESHOLD_SEC).toBe(25 * 60);
  });
});
