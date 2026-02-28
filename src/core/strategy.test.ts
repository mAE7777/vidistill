import { describe, it, expect } from 'vitest';
import { determineStrategy } from './strategy.js';
import type { VideoProfile } from '../types/index.js';

function makeProfile(overrides: Partial<VideoProfile> = {}): VideoProfile {
  return {
    type: 'lecture',
    complexity: 'simple',
    speakers: { count: 1, identified: [] },
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
    audioContent: {
      hasMultipleSpeakers: false,
      primaryLanguage: 'en',
      quality: 'high',
    },
    recommendations: {
      resolution: 'medium',
      segmentMinutes: 5,
      passes: [],
    },
    ...overrides,
  };
}

describe('determineStrategy', () => {
  describe('base passes', () => {
    it('always includes transcript, visual, synthesis', () => {
      const result = determineStrategy(makeProfile());
      expect(result.passes).toContain('transcript');
      expect(result.passes).toContain('visual');
      expect(result.passes).toContain('synthesis');
    });
  });

  describe('coding type', () => {
    it('includes code pass when hasCode is true', () => {
      const result = determineStrategy(
        makeProfile({ type: 'coding', visualContent: { ...makeProfile().visualContent, hasCode: true } })
      );
      expect(result.passes).toContain('code');
    });

    it('does not include code pass when hasCode is false', () => {
      const result = determineStrategy(
        makeProfile({ type: 'coding', visualContent: { ...makeProfile().visualContent, hasCode: false } })
      );
      expect(result.passes).not.toContain('code');
    });
  });

  describe('meeting type', () => {
    it('always includes people and implicit', () => {
      const result = determineStrategy(makeProfile({ type: 'meeting' }));
      expect(result.passes).toContain('people');
      expect(result.passes).toContain('implicit');
    });

    it('includes chat pass when hasChatbox is true', () => {
      const result = determineStrategy(
        makeProfile({ type: 'meeting', visualContent: { ...makeProfile().visualContent, hasChatbox: true } })
      );
      expect(result.passes).toContain('people');
      expect(result.passes).toContain('chat');
      expect(result.passes).toContain('implicit');
    });

    it('does not include chat pass when hasChatbox is false', () => {
      const result = determineStrategy(
        makeProfile({ type: 'meeting', visualContent: { ...makeProfile().visualContent, hasChatbox: false } })
      );
      expect(result.passes).not.toContain('chat');
    });

    it('includes code pass when hasCode is true', () => {
      const result = determineStrategy(
        makeProfile({ type: 'meeting', visualContent: { ...makeProfile().visualContent, hasCode: true } })
      );
      expect(result.passes).toContain('code');
    });
  });

  describe('lecture type', () => {
    it('includes implicit pass', () => {
      const result = determineStrategy(makeProfile({ type: 'lecture' }));
      expect(result.passes).toContain('implicit');
    });

    it('does not include people or chat passes', () => {
      const result = determineStrategy(makeProfile({ type: 'lecture' }));
      expect(result.passes).not.toContain('people');
      expect(result.passes).not.toContain('chat');
    });

    it('includes code pass when hasCode is true', () => {
      const result = determineStrategy(
        makeProfile({ type: 'lecture', visualContent: { ...makeProfile().visualContent, hasCode: true } })
      );
      expect(result.passes).toContain('code');
    });

    it('does not include code pass when hasCode is false', () => {
      const result = determineStrategy(makeProfile({ type: 'lecture' }));
      expect(result.passes).not.toContain('code');
    });
  });

  describe('presentation type', () => {
    it('includes implicit pass', () => {
      const result = determineStrategy(makeProfile({ type: 'presentation' }));
      expect(result.passes).toContain('implicit');
    });

    it('includes people pass when hasMultipleSpeakers is true', () => {
      const result = determineStrategy(
        makeProfile({
          type: 'presentation',
          audioContent: { ...makeProfile().audioContent, hasMultipleSpeakers: true },
        })
      );
      expect(result.passes).toContain('people');
    });

    it('does not include people pass when hasMultipleSpeakers is false', () => {
      const result = determineStrategy(
        makeProfile({
          type: 'presentation',
          audioContent: { ...makeProfile().audioContent, hasMultipleSpeakers: false },
        })
      );
      expect(result.passes).not.toContain('people');
    });
  });

  describe('conversation type', () => {
    it('includes implicit pass', () => {
      const result = determineStrategy(makeProfile({ type: 'conversation' }));
      expect(result.passes).toContain('implicit');
    });

    it('does not include code, people, or chat passes', () => {
      const result = determineStrategy(makeProfile({ type: 'conversation' }));
      expect(result.passes).not.toContain('code');
      expect(result.passes).not.toContain('people');
      expect(result.passes).not.toContain('chat');
    });
  });

  describe('mixed type', () => {
    it('includes all conditional passes: code, people, chat, implicit', () => {
      const result = determineStrategy(makeProfile({ type: 'mixed' }));
      expect(result.passes).toContain('code');
      expect(result.passes).toContain('people');
      expect(result.passes).toContain('chat');
      expect(result.passes).toContain('implicit');
    });
  });

  describe('complexity and segmentMinutes', () => {
    it('overrides segmentMinutes to 8 when complexity is complex and segmentMinutes > 8', () => {
      const result = determineStrategy(
        makeProfile({
          complexity: 'complex',
          recommendations: { resolution: 'medium', segmentMinutes: 12, passes: [] },
        })
      );
      expect(result.segmentMinutes).toBe(8);
    });

    it('keeps segmentMinutes as-is when complexity is complex but segmentMinutes <= 8', () => {
      const result = determineStrategy(
        makeProfile({
          complexity: 'complex',
          recommendations: { resolution: 'medium', segmentMinutes: 5, passes: [] },
        })
      );
      expect(result.segmentMinutes).toBe(5);
    });

    it('keeps segmentMinutes as-is when complexity is simple even if > 8', () => {
      const result = determineStrategy(
        makeProfile({
          complexity: 'simple',
          recommendations: { resolution: 'medium', segmentMinutes: 15, passes: [] },
        })
      );
      expect(result.segmentMinutes).toBe(15);
    });

    it('passes through segmentMinutes from recommendations for moderate complexity', () => {
      const result = determineStrategy(
        makeProfile({
          complexity: 'moderate',
          recommendations: { resolution: 'medium', segmentMinutes: 6, passes: [] },
        })
      );
      expect(result.segmentMinutes).toBe(6);
    });
  });

  describe('resolution', () => {
    it('passes through resolution from recommendations', () => {
      const result = determineStrategy(
        makeProfile({ recommendations: { resolution: 'high', segmentMinutes: 5, passes: [] } })
      );
      expect(result.resolution).toBe('high');
    });

    it('passes through low resolution', () => {
      const result = determineStrategy(
        makeProfile({ recommendations: { resolution: 'low', segmentMinutes: 5, passes: [] } })
      );
      expect(result.resolution).toBe('low');
    });

    it('passes through medium resolution', () => {
      const result = determineStrategy(
        makeProfile({ recommendations: { resolution: 'medium', segmentMinutes: 5, passes: [] } })
      );
      expect(result.resolution).toBe('medium');
    });
  });

  describe('acceptance criteria', () => {
    it('coding with hasCode: true — passes includes code', () => {
      const result = determineStrategy(
        makeProfile({ type: 'coding', visualContent: { ...makeProfile().visualContent, hasCode: true } })
      );
      expect(result.passes).toContain('code');
    });

    it('meeting with hasChatbox: true — passes includes people, chat, implicit', () => {
      const result = determineStrategy(
        makeProfile({ type: 'meeting', visualContent: { ...makeProfile().visualContent, hasChatbox: true } })
      );
      expect(result.passes).toContain('people');
      expect(result.passes).toContain('chat');
      expect(result.passes).toContain('implicit');
    });

    it('mixed — passes includes all conditional passes', () => {
      const result = determineStrategy(makeProfile({ type: 'mixed' }));
      expect(result.passes).toContain('code');
      expect(result.passes).toContain('people');
      expect(result.passes).toContain('chat');
      expect(result.passes).toContain('implicit');
    });

    it('complex complexity — segmentMinutes is 8 when recommendations.segmentMinutes > 8', () => {
      const result = determineStrategy(
        makeProfile({
          complexity: 'complex',
          recommendations: { resolution: 'medium', segmentMinutes: 10, passes: [] },
        })
      );
      expect(result.segmentMinutes).toBe(8);
    });
  });
});
