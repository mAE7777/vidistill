import { describe, it, expect } from 'vitest';
import { MediaResolution } from '@google/genai';
import { createSegmentPlan } from './segmenter.js';

describe('createSegmentPlan', () => {
  // ---------------------------------------------------------------------------
  // AC 1: 7-minute video → 1 segment
  // ---------------------------------------------------------------------------
  describe('short video (≤ 10 min)', () => {
    it('returns 1 segment for a 7-minute video', () => {
      const plan = createSegmentPlan(420);

      expect(plan.segments).toHaveLength(1);
      expect(plan.segments[0]).toEqual({ index: 0, startTime: 0, endTime: 420 });
      expect(plan.resolution).toBe(MediaResolution.MEDIA_RESOLUTION_MEDIUM);
    });

    it('returns 1 segment at exactly 10 minutes', () => {
      const plan = createSegmentPlan(600);

      expect(plan.segments).toHaveLength(1);
      expect(plan.segments[0]).toEqual({ index: 0, startTime: 0, endTime: 600 });
      expect(plan.resolution).toBe(MediaResolution.MEDIA_RESOLUTION_MEDIUM);
    });
  });

  // ---------------------------------------------------------------------------
  // Medium video (> 10 min, ≤ 30 min) → 1 segment, LOW resolution
  // ---------------------------------------------------------------------------
  describe('medium video (> 10 min and ≤ 30 min)', () => {
    it('returns 1 segment for a 20-minute video', () => {
      const plan = createSegmentPlan(1200);

      expect(plan.segments).toHaveLength(1);
      expect(plan.segments[0]).toEqual({ index: 0, startTime: 0, endTime: 1200 });
      expect(plan.resolution).toBe(MediaResolution.MEDIA_RESOLUTION_LOW);
    });

    it('returns 1 segment at exactly 30 minutes', () => {
      const plan = createSegmentPlan(1800);

      expect(plan.segments).toHaveLength(1);
      expect(plan.segments[0]).toEqual({ index: 0, startTime: 0, endTime: 1800 });
      expect(plan.resolution).toBe(MediaResolution.MEDIA_RESOLUTION_LOW);
    });
  });

  // ---------------------------------------------------------------------------
  // AC 2: 47-minute video → 5 segments of ~10 min, MEDIUM resolution
  // ---------------------------------------------------------------------------
  describe('long video (> 30 min and ≤ 60 min)', () => {
    it('returns 5 segments for a 47-minute video', () => {
      const plan = createSegmentPlan(2820);

      // ceil(2820 / 600) = ceil(4.7) = 5
      expect(plan.segments).toHaveLength(5);
      expect(plan.resolution).toBe(MediaResolution.MEDIA_RESOLUTION_MEDIUM);
    });

    it('last segment ends at exact video duration (2820)', () => {
      const plan = createSegmentPlan(2820);

      const last = plan.segments[plan.segments.length - 1];
      expect(last.endTime).toBe(2820);
    });

    it('segments have correct indices and boundaries for 47-minute video', () => {
      const plan = createSegmentPlan(2820);

      expect(plan.segments[0]).toEqual({ index: 0, startTime: 0, endTime: 600 });
      expect(plan.segments[1]).toEqual({ index: 1, startTime: 600, endTime: 1200 });
      expect(plan.segments[2]).toEqual({ index: 2, startTime: 1200, endTime: 1800 });
      expect(plan.segments[3]).toEqual({ index: 3, startTime: 1800, endTime: 2400 });
      expect(plan.segments[4]).toEqual({ index: 4, startTime: 2400, endTime: 2820 });
    });

    it('returns MEDIUM resolution for a video just over 30 minutes', () => {
      const plan = createSegmentPlan(1801);

      expect(plan.resolution).toBe(MediaResolution.MEDIA_RESOLUTION_MEDIUM);
    });

    it('returns correct count at exactly 60 minutes', () => {
      // ceil(3600 / 600) = 6
      const plan = createSegmentPlan(3600);

      expect(plan.segments).toHaveLength(6);
      expect(plan.resolution).toBe(MediaResolution.MEDIA_RESOLUTION_MEDIUM);
    });
  });

  // ---------------------------------------------------------------------------
  // AC 3: 90-minute video → 9 segments, LOW resolution
  // ---------------------------------------------------------------------------
  describe('very long video (> 60 min)', () => {
    it('returns 9 segments for a 90-minute video', () => {
      const plan = createSegmentPlan(5400);

      // ceil(5400 / 600) = 9
      expect(plan.segments).toHaveLength(9);
      expect(plan.resolution).toBe(MediaResolution.MEDIA_RESOLUTION_LOW);
    });

    it('last segment ends at exact video duration (5400)', () => {
      const plan = createSegmentPlan(5400);

      const last = plan.segments[plan.segments.length - 1];
      expect(last.endTime).toBe(5400);
    });

    it('segments are contiguous with correct indices for 90-minute video', () => {
      const plan = createSegmentPlan(5400);

      for (let i = 0; i < plan.segments.length; i++) {
        expect(plan.segments[i].index).toBe(i);
        expect(plan.segments[i].startTime).toBe(i * 600);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // AC 4: segmentMinutes override
  // ---------------------------------------------------------------------------
  describe('segmentMinutes override', () => {
    it('returns ceil(47/8) = 6 segments when segmentMinutes is 8', () => {
      const plan = createSegmentPlan(2820, { segmentMinutes: 8 });

      // 8 min = 480s; ceil(2820 / 480) = ceil(5.875) = 6
      expect(plan.segments).toHaveLength(6);
    });

    it('last segment ends at exact video duration when using segmentMinutes override', () => {
      const plan = createSegmentPlan(2820, { segmentMinutes: 8 });

      const last = plan.segments[plan.segments.length - 1];
      expect(last.endTime).toBe(2820);
    });

    it('uses custom segment duration for boundaries', () => {
      const plan = createSegmentPlan(2820, { segmentMinutes: 8 });

      expect(plan.segments[0]).toEqual({ index: 0, startTime: 0, endTime: 480 });
      expect(plan.segments[1]).toEqual({ index: 1, startTime: 480, endTime: 960 });
    });

    it('segmentMinutes override on a short video still uses 1-segment threshold rules', () => {
      // 5-minute video is still ≤ 10 min → always 1 segment
      const plan = createSegmentPlan(300, { segmentMinutes: 2 });

      expect(plan.segments).toHaveLength(1);
      expect(plan.segments[0]).toEqual({ index: 0, startTime: 0, endTime: 300 });
    });
  });

  // ---------------------------------------------------------------------------
  // Resolution override from Pass 0
  // ---------------------------------------------------------------------------
  describe('resolution override', () => {
    it('resolution "low" maps to MEDIA_RESOLUTION_LOW', () => {
      const plan = createSegmentPlan(2820, { resolution: 'low' });
      expect(plan.resolution).toBe(MediaResolution.MEDIA_RESOLUTION_LOW);
    });

    it('resolution "high" maps to MEDIA_RESOLUTION_HIGH', () => {
      const plan = createSegmentPlan(2820, { resolution: 'high' });
      expect(plan.resolution).toBe(MediaResolution.MEDIA_RESOLUTION_HIGH);
    });

    it('resolution "medium" maps to MEDIA_RESOLUTION_MEDIUM', () => {
      const plan = createSegmentPlan(2820, { resolution: 'medium' });
      expect(plan.resolution).toBe(MediaResolution.MEDIA_RESOLUTION_MEDIUM);
    });

    it('resolution override applies even to short single-segment videos', () => {
      const plan = createSegmentPlan(300, { resolution: 'high' });
      expect(plan.segments).toHaveLength(1);
      expect(plan.resolution).toBe(MediaResolution.MEDIA_RESOLUTION_HIGH);
    });

    it('no resolution override preserves existing computed resolution', () => {
      const plan = createSegmentPlan(2820);
      expect(plan.resolution).toBe(MediaResolution.MEDIA_RESOLUTION_MEDIUM);
    });

    it('invalid resolution string falls back to computed default', () => {
      const plan = createSegmentPlan(2820, { resolution: 'ultra' });
      // 'ultra' is not in RESOLUTION_MAP → undefined → falls back to computed
      expect(plan.resolution).toBe(MediaResolution.MEDIA_RESOLUTION_MEDIUM);
    });
  });

  // ---------------------------------------------------------------------------
  // Segment shape contract
  // ---------------------------------------------------------------------------
  describe('segment shape', () => {
    it('each segment has index, startTime, endTime', () => {
      const plan = createSegmentPlan(2820);

      for (const seg of plan.segments) {
        expect(typeof seg.index).toBe('number');
        expect(typeof seg.startTime).toBe('number');
        expect(typeof seg.endTime).toBe('number');
      }
    });

    it('first segment always starts at 0', () => {
      const plan = createSegmentPlan(2820);

      expect(plan.segments[0].startTime).toBe(0);
    });
  });
});
