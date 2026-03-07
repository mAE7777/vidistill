import type { VideoProfile, PassStrategy } from '../types/index.js';

const BASE_PASSES = ['transcript', 'visual'];

export function determineStrategy(profile: VideoProfile): PassStrategy {
  const passes = new Set<string>(BASE_PASSES);

  const { type, visualContent, audioContent, complexity, recommendations } = profile;

  // Code pass runs for any video type when code is visible on screen
  if (visualContent.hasCode) {
    passes.add('code');
  }

  switch (type) {
    case 'coding':
      break;
    case 'meeting':
      passes.add('people');
      if (visualContent.hasChatbox) {
        passes.add('chat');
      }
      passes.add('implicit');
      break;
    case 'lecture':
      passes.add('implicit');
      break;
    case 'presentation':
      passes.add('implicit');
      if (audioContent.hasMultipleSpeakers) {
        passes.add('people');
      }
      break;
    case 'conversation':
      passes.add('implicit');
      break;
    case 'commentary':
      passes.add('implicit');
      break;
    case 'mixed':
      passes.add('code');
      passes.add('people');
      passes.add('chat');
      passes.add('implicit');
      break;
    case 'audio':
      // Audio-only: no visual analysis, no code (requires visual data)
      passes.delete('visual');
      passes.delete('code');
      passes.add('people');
      passes.add('implicit');
      break;
    default:
      break;
  }

  const resolution = recommendations.resolution ?? 'medium';
  const segmentMinutes =
    complexity === 'complex' && recommendations.segmentMinutes > 8
      ? 8
      : recommendations.segmentMinutes;

  passes.add('synthesis');

  return {
    passes: Array.from(passes),
    resolution,
    segmentMinutes,
  };
}
