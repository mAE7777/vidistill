import { describe, it, expect, vi } from 'vitest';
import type { GeminiClient } from '../gemini/client.js';
import { runSynthesis } from './synthesis.js';
import type {
  SegmentResult,
  VideoProfile,
  PeopleExtraction,
  SynthesisResult,
} from '../types/index.js';

function makeClient(result: unknown): GeminiClient {
  return {
    generate: vi.fn().mockResolvedValue(result),
  } as unknown as GeminiClient;
}

const VIDEO_PROFILE: VideoProfile = {
  type: 'coding',
  speakers: { count: 1, identified: ['Instructor'] },
  visualContent: {
    hasCode: true,
    hasSlides: false,
    hasDiagrams: false,
    hasPeopleGrid: false,
    hasChatbox: false,
    hasWhiteboard: false,
    hasTerminal: true,
    hasScreenShare: true,
  },
  audioContent: {
    hasMultipleSpeakers: false,
    primaryLanguage: 'English',
    quality: 'high',
  },
  complexity: 'moderate',
  recommendations: {
    resolution: 'high',
    segmentMinutes: 10,
    passes: ['transcript', 'visual', 'code', 'synthesis'],
  },
};

const SEGMENT_WITH_CODE: SegmentResult = {
  index: 0,
  pass1: {
    segment_index: 0,
    time_range: '00:00:00 - 00:10:00',
    transcript_entries: [
      { timestamp: '00:00:05', speaker: 'SPEAKER_00', text: 'Hello everyone', tone: 'neutral' },
      { timestamp: '00:00:12', speaker: 'SPEAKER_00', text: 'Welcome to the tutorial', tone: 'instructional' },
    ],
    speaker_summary: [{ speaker_id: 'SPEAKER_00', description: 'Instructor' }],
  },
  pass2: {
    segment_index: 0,
    time_range: '00:00:00 - 00:10:00',
    code_blocks: [
      {
        timestamp: '00:01:30',
        filename: 'index.ts',
        language: 'typescript',
        content: 'const app = express()',
        screen_type: 'code_editor',
        change_type: 'new_file',
        instructor_explanation: 'Creating the main app',
      },
    ],
    visual_notes: [
      {
        timestamp: '00:02:00',
        visual_type: 'slide',
        description: 'Introduction to Express',
      },
    ],
    screen_timeline: [],
  },
  pass3a: {
    files: [
      {
        filename: 'index.ts',
        language: 'typescript',
        final_content: 'const app = express()\napp.listen(3000)',
        changes: [
          {
            timestamp: '00:01:30',
            change_type: 'create',
            description: 'Initial file',
            diff_summary: 'Added app setup',
          },
        ],
      },
    ],
    dependencies_mentioned: ['express'],
    build_commands: ['npm install'],
  },
};

const SEGMENT_WITH_CHAT: SegmentResult = {
  index: 1,
  pass1: {
    segment_index: 1,
    time_range: '00:10:00 - 00:20:00',
    transcript_entries: [
      { timestamp: '00:10:05', speaker: 'SPEAKER_00', text: 'Now we add routing', tone: 'instructional' },
    ],
    speaker_summary: [],
  },
  pass2: {
    segment_index: 1,
    time_range: '00:10:00 - 00:20:00',
    code_blocks: [],
    visual_notes: [],
    screen_timeline: [],
  },
  pass3c: {
    messages: [
      { timestamp: '00:03:00', sender: 'user123', text: 'Great tutorial!' },
    ],
    links: [],
  },
  pass3d: {
    emotional_shifts: [
      { timestamp: '00:05:00', from_state: 'calm', to_state: 'excited', trigger: 'demo working' },
    ],
    questions_implicit: [],
    decisions_implicit: [],
    tasks_assigned: [
      { timestamp: '00:07:00', assignee: 'viewer', task: 'Try it at home', deadline: '' },
    ],
    emphasis_patterns: [],
  },
};

const PEOPLE_EXTRACTION: PeopleExtraction = {
  participants: [
    {
      name: 'John Doe',
      role: 'Instructor',
      organization: 'Acme Corp',
      speaking_segments: ['00:00:05'],
      contact_info: [],
      contributions: ['Taught Express setup'],
    },
  ],
  relationships: [],
};

const VALID_RESULT: SynthesisResult = {
  overview: 'A coding tutorial covering Express.js setup.',
  key_decisions: [],
  key_concepts: [
    { concept: 'Express setup', explanation: 'Creating an Express app', timestamp: '00:01:30' },
  ],
  action_items: [],
  questions_raised: [],
  suggestions: ['Explore middleware'],
  topics: [
    {
      title: 'Express.js Basics',
      timestamps: ['00:01:30'],
      summary: 'Setting up an Express server',
      key_points: ['app = express()', 'app.listen(3000)'],
    },
  ],
  files_to_generate: ['combined.md', 'code/', 'people.md'],
};

describe('runSynthesis', () => {
  it('returns SynthesisResult when Gemini returns valid data', async () => {
    const client = makeClient(VALID_RESULT);
    const result = await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [SEGMENT_WITH_CODE],
      videoProfile: VIDEO_PROFILE,
    });

    expect(result).toEqual(VALID_RESULT);
  });

  it('throws when result is null', async () => {
    const client = makeClient(null);

    await expect(
      runSynthesis({
        client,
        model: 'gemini-2.5-flash',
        segmentResults: [],
        videoProfile: VIDEO_PROFILE,
      }),
    ).rejects.toThrow('Incomplete SynthesisResult from Gemini synthesis');
  });

  it('throws when overview is missing', async () => {
    const client = makeClient({ files_to_generate: [] });

    await expect(
      runSynthesis({
        client,
        model: 'gemini-2.5-flash',
        segmentResults: [],
        videoProfile: VIDEO_PROFILE,
      }),
    ).rejects.toThrow('Incomplete SynthesisResult from Gemini synthesis');
  });

  it('throws when files_to_generate is missing', async () => {
    const client = makeClient({ overview: 'A video about coding.' });

    await expect(
      runSynthesis({
        client,
        model: 'gemini-2.5-flash',
        segmentResults: [],
        videoProfile: VIDEO_PROFILE,
      }),
    ).rejects.toThrow('Incomplete SynthesisResult from Gemini synthesis');
  });

  it('throws when overview is not a string', async () => {
    const client = makeClient({ overview: 42, files_to_generate: [] });

    await expect(
      runSynthesis({
        client,
        model: 'gemini-2.5-flash',
        segmentResults: [],
        videoProfile: VIDEO_PROFILE,
      }),
    ).rejects.toThrow('Incomplete SynthesisResult from Gemini synthesis');
  });

  it('throws when files_to_generate is not an array', async () => {
    const client = makeClient({ overview: 'Summary', files_to_generate: 'not-an-array' });

    await expect(
      runSynthesis({
        client,
        model: 'gemini-2.5-flash',
        segmentResults: [],
        videoProfile: VIDEO_PROFILE,
      }),
    ).rejects.toThrow('Incomplete SynthesisResult from Gemini synthesis');
  });

  it('sends text-only contents (no fileData, no videoMetadata)', async () => {
    const client = makeClient(VALID_RESULT);
    await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [SEGMENT_WITH_CODE],
      videoProfile: VIDEO_PROFILE,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.contents).toHaveLength(1);
    expect(call.contents[0].role).toBe('user');
    expect(call.contents[0].parts).toHaveLength(1);
    expect(typeof call.contents[0].parts[0].text).toBe('string');
    expect('fileData' in call.contents[0].parts[0]).toBe(false);
    expect('videoMetadata' in call.contents[0].parts[0]).toBe(false);
  });

  it('passes correct model and config to client.generate', async () => {
    const client = makeClient(VALID_RESULT);
    await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [],
      videoProfile: VIDEO_PROFILE,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.model).toBe('gemini-2.5-flash');
    expect(call.config.responseMimeType).toBe('application/json');
    expect(call.config.maxOutputTokens).toBe(65536);
    expect(call.config.temperature).toBe(1.0);
  });

  it('compiles segment transcript entries into context text', async () => {
    const client = makeClient(VALID_RESULT);
    await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [SEGMENT_WITH_CODE],
      videoProfile: VIDEO_PROFILE,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const text = call.contents[0].parts[0].text as string;
    expect(text).toContain('[00:00:05] SPEAKER_00: Hello everyone');
    expect(text).toContain('[00:00:12] SPEAKER_00: Welcome to the tutorial');
  });

  it('compiles segment code blocks into context text', async () => {
    const client = makeClient(VALID_RESULT);
    await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [SEGMENT_WITH_CODE],
      videoProfile: VIDEO_PROFILE,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const text = call.contents[0].parts[0].text as string;
    expect(text).toContain('[00:01:30] index.ts (typescript):');
    expect(text).toContain('const app = express()');
  });

  it('compiles segment visual notes into context text', async () => {
    const client = makeClient(VALID_RESULT);
    await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [SEGMENT_WITH_CODE],
      videoProfile: VIDEO_PROFILE,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const text = call.contents[0].parts[0].text as string;
    expect(text).toContain('[00:02:00] slide: Introduction to Express');
  });

  it('compiles pass3a (code reconstruction) into context text', async () => {
    const client = makeClient(VALID_RESULT);
    await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [SEGMENT_WITH_CODE],
      videoProfile: VIDEO_PROFILE,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const text = call.contents[0].parts[0].text as string;
    expect(text).toContain('--- Code Reconstruction ---');
    expect(text).toContain('File: index.ts (typescript)');
    expect(text).toContain('Final content:');
  });

  it('compiles pass3c (chat messages) into context text', async () => {
    const client = makeClient(VALID_RESULT);
    await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [SEGMENT_WITH_CHAT],
      videoProfile: VIDEO_PROFILE,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const text = call.contents[0].parts[0].text as string;
    expect(text).toContain('--- Chat Messages ---');
    expect(text).toContain('[00:03:00] user123: Great tutorial!');
  });

  it('compiles pass3d (implicit signals) into context text', async () => {
    const client = makeClient(VALID_RESULT);
    await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [SEGMENT_WITH_CHAT],
      videoProfile: VIDEO_PROFILE,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const text = call.contents[0].parts[0].text as string;
    expect(text).toContain('--- Implicit Signals ---');
    expect(text).toContain('Emotional shifts:');
    expect(text).toContain('calm');
    expect(text).toContain('excited');
    expect(text).toContain('Tasks assigned:');
    expect(text).toContain('Try it at home');
  });

  it('includes video profile summary in context text', async () => {
    const client = makeClient(VALID_RESULT);
    await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [],
      videoProfile: VIDEO_PROFILE,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const text = call.contents[0].parts[0].text as string;
    expect(text).toContain('=== VIDEO PROFILE ===');
    expect(text).toContain('Type: coding');
    expect(text).toContain('Complexity: moderate');
    expect(text).toContain('Speakers: 1');
  });

  it('includes people data in context text when provided', async () => {
    const client = makeClient(VALID_RESULT);
    await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [],
      videoProfile: VIDEO_PROFILE,
      peopleExtraction: PEOPLE_EXTRACTION,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const text = call.contents[0].parts[0].text as string;
    expect(text).toContain('=== PEOPLE ===');
    expect(text).toContain('John Doe');
    expect(text).toContain('Instructor');
    expect(text).toContain('Acme Corp');
  });

  it('includes placeholder when peopleExtraction is null', async () => {
    const client = makeClient(VALID_RESULT);
    await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [],
      videoProfile: VIDEO_PROFILE,
      peopleExtraction: null,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const text = call.contents[0].parts[0].text as string;
    expect(text).toContain('[No people data]');
  });

  it('includes placeholder when peopleExtraction is omitted', async () => {
    const client = makeClient(VALID_RESULT);
    await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [],
      videoProfile: VIDEO_PROFILE,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const text = call.contents[0].parts[0].text as string;
    expect(text).toContain('[No people data]');
  });

  it('injects user-provided context string into prompt', async () => {
    const client = makeClient(VALID_RESULT);
    await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [],
      videoProfile: VIDEO_PROFILE,
      context: 'This is an advanced Express.js course for senior developers.',
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const text = call.contents[0].parts[0].text as string;
    expect(text).toContain('=== USER CONTEXT ===');
    expect(text).toContain('This is an advanced Express.js course for senior developers.');
  });

  it('includes placeholder when context is not provided', async () => {
    const client = makeClient(VALID_RESULT);
    await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [],
      videoProfile: VIDEO_PROFILE,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const text = call.contents[0].parts[0].text as string;
    expect(text).toContain('[No user context provided]');
  });

  it('compiles multiple segments with correct segment headers', async () => {
    const client = makeClient(VALID_RESULT);
    await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [SEGMENT_WITH_CODE, SEGMENT_WITH_CHAT],
      videoProfile: VIDEO_PROFILE,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const text = call.contents[0].parts[0].text as string;
    expect(text).toContain('=== SEGMENT 1 (00:00:00 - 00:10:00) ===');
    expect(text).toContain('=== SEGMENT 2 (00:10:00 - 00:20:00) ===');
  });

  it('omits code reconstruction section when pass3a is absent', async () => {
    const client = makeClient(VALID_RESULT);
    const segWithoutCode: SegmentResult = {
      index: 0,
      pass1: null,
      pass2: null,
    };
    await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [segWithoutCode],
      videoProfile: VIDEO_PROFILE,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const text = call.contents[0].parts[0].text as string;
    expect(text).not.toContain('--- Code Reconstruction ---');
  });

  it('omits chat section when pass3c is absent', async () => {
    const client = makeClient(VALID_RESULT);
    await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [SEGMENT_WITH_CODE],
      videoProfile: VIDEO_PROFILE,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const text = call.contents[0].parts[0].text as string;
    expect(text).not.toContain('--- Chat Messages ---');
  });

  it('omits implicit signals section when pass3d is absent', async () => {
    const client = makeClient(VALID_RESULT);
    await runSynthesis({
      client,
      model: 'gemini-2.5-flash',
      segmentResults: [SEGMENT_WITH_CODE],
      videoProfile: VIDEO_PROFILE,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const text = call.contents[0].parts[0].text as string;
    expect(text).not.toContain('--- Implicit Signals ---');
  });

  it('propagates errors thrown by client.generate', async () => {
    const client = {
      generate: vi.fn().mockRejectedValue(new Error('Gemini API error')),
    } as unknown as GeminiClient;

    await expect(
      runSynthesis({
        client,
        model: 'gemini-2.5-flash',
        segmentResults: [],
        videoProfile: VIDEO_PROFILE,
      }),
    ).rejects.toThrow('Gemini API error');
  });
});
