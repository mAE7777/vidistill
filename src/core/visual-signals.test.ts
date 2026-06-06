import { describe, expect, it } from 'vitest';
import type { Pass2Result } from '../types/index.js';
import { collectChatCandidateDescriptions, isChatRegionType, pass2HasChatCandidate } from './visual-signals.js';

function makePass2(overrides: Partial<Pass2Result> = {}): Pass2Result {
  return {
    segment_index: 0,
    time_range: '00:00:00 - 00:10:00',
    code_blocks: [],
    visual_notes: [],
    screen_timeline: [],
    ...overrides,
  };
}

describe('visual chat signals', () => {
  it('detects structured chat regions', () => {
    const pass2 = makePass2({
      visual_regions: [
        {
          timestamp: '00:05:05',
          region_type: 'chat',
          label: 'Join the conversation',
          bbox: { x: 0.67, y: 0.08, width: 0.29, height: 0.84 },
          visible: true,
          sample_text: 'techstars.com/accelerators/permanente-medicine',
          confidence: 0.95,
        },
      ],
    });

    expect(pass2HasChatCandidate(pass2)).toBe(true);
    expect(collectChatCandidateDescriptions(pass2)[0]).toContain('Join the conversation');
  });

  it('detects chat language in visual notes when no region is present', () => {
    const pass2 = makePass2({
      visual_notes: [
        { timestamp: '00:50:00', visual_type: 'other', description: 'Right sidebar shows live conversations and audience questions' },
      ],
    });

    expect(pass2HasChatCandidate(pass2)).toBe(true);
  });

  it('does not classify ordinary slide text as chat', () => {
    const pass2 = makePass2({
      visual_notes: [
        { timestamp: '00:01:00', visual_type: 'slide', description: 'Founder pitch workshop agenda' },
      ],
      screen_timeline: [
        { timestamp: '00:01:00', screen_state: 'slide deck with agenda' },
      ],
    });

    expect(pass2HasChatCandidate(pass2)).toBe(false);
  });

  it('recognizes all chat-like region types', () => {
    expect(isChatRegionType('chat')).toBe(true);
    expect(isChatRegionType('comment_panel')).toBe(true);
    expect(isChatRegionType('sidebar')).toBe(true);
    expect(isChatRegionType('slide')).toBe(false);
  });
});
