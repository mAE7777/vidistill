import { describe, it, expect, vi } from 'vitest';
import type { GeminiClient } from '../gemini/client.js';
import { runCodeReconstruction, compileContext } from './code.js';
import type { Pass1Result, Pass2Result, CodeReconstruction } from '../types/index.js';

function makeClient(result: unknown): GeminiClient {
  return {
    generate: vi.fn().mockResolvedValue(result),
  } as unknown as GeminiClient;
}

const VALID_PASS1: Pass1Result = {
  segment_index: 0,
  time_range: '00:00:00 - 00:01:00',
  transcript_entries: [
    { timestamp: '00:00:05', speaker: 'SPEAKER_00', text: 'Now I will create the main file', tone: 'instructional' },
  ],
  speaker_summary: [{ speaker_id: 'SPEAKER_00', description: 'Instructor' }],
};

const VALID_PASS2: Pass2Result = {
  segment_index: 0,
  time_range: '00:00:00 - 00:01:00',
  code_blocks: [
    {
      timestamp: '00:00:10',
      filename: 'main.py',
      language: 'python',
      content: 'def hello():\n    print("Hello")',
      screen_type: 'code_editor',
      change_type: 'new_file',
      instructor_explanation: 'Creating the main file',
    },
  ],
  visual_notes: [],
  screen_timeline: [],
};

const VALID_RESULT: CodeReconstruction = {
  files: [
    {
      filename: 'main.py',
      language: 'python',
      final_content: 'def hello():\n    print("Hello")',
      changes: [
        {
          timestamp: '00:00:10',
          change_type: 'create',
          description: 'Initial file creation',
          diff_summary: 'Added hello function',
        },
      ],
    },
  ],
  dependencies_mentioned: [],
  build_commands: [],
};

describe('runCodeReconstruction', () => {
  it('returns CodeReconstruction when Gemini returns valid data', async () => {
    const client = makeClient(VALID_RESULT);
    const result = await runCodeReconstruction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      duration: 60,
      model: 'gemini-2.5-flash',
      pass1Results: [VALID_PASS1],
      pass2Results: [VALID_PASS2],
    });

    expect(result).toEqual(VALID_RESULT);
  });

  it('throws when result is null', async () => {
    const client = makeClient(null);

    await expect(
      runCodeReconstruction({
        client,
        fileUri: 'files/x',
        mimeType: 'video/mp4',
        duration: 60,
        model: 'gemini-2.5-flash',
        pass1Results: [],
        pass2Results: [],
      }),
    ).rejects.toThrow('Incomplete CodeReconstruction from Gemini Pass 3a');
  });

  it('throws when files field is missing', async () => {
    const client = makeClient({ dependencies_mentioned: [], build_commands: [] });

    await expect(
      runCodeReconstruction({
        client,
        fileUri: 'files/x',
        mimeType: 'video/mp4',
        duration: 60,
        model: 'gemini-2.5-flash',
        pass1Results: [],
        pass2Results: [],
      }),
    ).rejects.toThrow('Incomplete CodeReconstruction from Gemini Pass 3a');
  });

  it('throws when files is not an array', async () => {
    const client = makeClient({ files: 'not-an-array', dependencies_mentioned: [], build_commands: [] });

    await expect(
      runCodeReconstruction({
        client,
        fileUri: 'files/x',
        mimeType: 'video/mp4',
        duration: 60,
        model: 'gemini-2.5-flash',
        pass1Results: [],
        pass2Results: [],
      }),
    ).rejects.toThrow('Incomplete CodeReconstruction from Gemini Pass 3a');
  });

  it('does not include videoMetadata in fileData (whole-video pass)', async () => {
    const client = makeClient(VALID_RESULT);
    await runCodeReconstruction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      duration: 300,
      model: 'gemini-2.5-flash',
      pass1Results: [VALID_PASS1],
      pass2Results: [VALID_PASS2],
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const filePart = call.contents[0].parts[0];
    expect(filePart.fileData).toEqual({ fileUri: 'files/abc123', mimeType: 'video/mp4' });
    expect('videoMetadata' in filePart).toBe(false);
  });

  it('forwards resolution when provided', async () => {
    const { MediaResolution } = await import('@google/genai');
    const client = makeClient(VALID_RESULT);
    await runCodeReconstruction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      duration: 60,
      model: 'gemini-2.5-flash',
      resolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
      pass1Results: [],
      pass2Results: [],
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.config.mediaResolution).toBe(MediaResolution.MEDIA_RESOLUTION_MEDIUM);
  });

  it('omits resolution from config when not provided', async () => {
    const client = makeClient(VALID_RESULT);
    await runCodeReconstruction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      duration: 60,
      model: 'gemini-2.5-flash',
      pass1Results: [],
      pass2Results: [],
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect('mediaResolution' in call.config).toBe(false);
  });

  it('propagates errors thrown by client.generate', async () => {
    const client = {
      generate: vi.fn().mockRejectedValue(new Error('Gemini API error')),
    } as unknown as GeminiClient;

    await expect(
      runCodeReconstruction({
        client,
        fileUri: 'files/x',
        mimeType: 'video/mp4',
        duration: 60,
        model: 'gemini-2.5-flash',
        pass1Results: [],
        pass2Results: [],
      }),
    ).rejects.toThrow('Gemini API error');
  });
});

describe('compileContext', () => {
  it('includes TRANSCRIPT header with all segments', () => {
    const pass1Results: (Pass1Result | null)[] = [VALID_PASS1];
    const pass2Results: (Pass2Result | null)[] = [VALID_PASS2];
    const ctx = compileContext(60, pass1Results, pass2Results);

    expect(ctx).toContain('TRANSCRIPT (all segments):');
    expect(ctx).toContain('=== Segment 1 (00:00:00 - 00:01:00) ===');
    expect(ctx).toContain('[00:00:05] SPEAKER_00: Now I will create the main file');
  });

  it('includes CODE BLOCKS header with all segments', () => {
    const pass1Results: (Pass1Result | null)[] = [VALID_PASS1];
    const pass2Results: (Pass2Result | null)[] = [VALID_PASS2];
    const ctx = compileContext(60, pass1Results, pass2Results);

    expect(ctx).toContain('CODE BLOCKS EXTRACTED (all segments):');
    expect(ctx).toContain('=== Segment 1 (00:00:00 - 00:01:00) ===');
    expect(ctx).toContain('[00:00:10] python:');
    expect(ctx).toContain('def hello():');
  });

  it('shows [No transcript available] for null pass1Result', () => {
    const pass1Results: (Pass1Result | null)[] = [null];
    const pass2Results: (Pass2Result | null)[] = [VALID_PASS2];
    const ctx = compileContext(60, pass1Results, pass2Results);

    expect(ctx).toContain('[No transcript available]');
  });

  it('uses segment index fallback header when time_range is unavailable', () => {
    const p1: Pass1Result = { ...VALID_PASS1, time_range: '' };
    const p2: Pass2Result = { ...VALID_PASS2, time_range: '' };
    const ctx = compileContext(60, [p1], [p2]);

    expect(ctx).toContain('=== Segment 1 ===');
  });

  it('includes transcripts from all 3 segments', () => {
    const p1a: Pass1Result = { ...VALID_PASS1, segment_index: 0, time_range: '00:00:00 - 00:01:00' };
    const p1b: Pass1Result = {
      segment_index: 1,
      time_range: '00:01:00 - 00:02:00',
      transcript_entries: [{ timestamp: '00:01:30', speaker: 'SPEAKER_01', text: 'Second segment', tone: 'neutral' }],
      speaker_summary: [],
    };
    const p1c: Pass1Result = {
      segment_index: 2,
      time_range: '00:02:00 - 00:03:00',
      transcript_entries: [{ timestamp: '00:02:30', speaker: 'SPEAKER_00', text: 'Third segment', tone: 'neutral' }],
      speaker_summary: [],
    };

    const ctx = compileContext(180, [p1a, p1b, p1c], [null, null, null]);

    expect(ctx).toContain('=== Segment 1 (00:00:00 - 00:01:00) ===');
    expect(ctx).toContain('=== Segment 2 (00:01:00 - 00:02:00) ===');
    expect(ctx).toContain('=== Segment 3 (00:02:00 - 00:03:00) ===');
    expect(ctx).toContain('Now I will create the main file');
    expect(ctx).toContain('Second segment');
    expect(ctx).toContain('Third segment');
  });

  it('for video > 60 min, skips transcript segments where no code_blocks were found', () => {
    const p1a: Pass1Result = { ...VALID_PASS1, segment_index: 0, time_range: '00:00:00 - 00:01:00' };
    const p1b: Pass1Result = {
      segment_index: 1,
      time_range: '01:01:00 - 01:02:00',
      transcript_entries: [{ timestamp: '01:01:30', speaker: 'SPEAKER_00', text: 'Long video segment', tone: 'neutral' }],
      speaker_summary: [],
    };

    // Only segment 0 has code blocks, segment 1 does not
    const p2a: Pass2Result = { ...VALID_PASS2, segment_index: 0 };
    const p2b: Pass2Result = { ...VALID_PASS2, segment_index: 1, code_blocks: [] };

    // 3700 seconds > 3600 = long video
    const ctx = compileContext(3700, [p1a, p1b], [p2a, p2b]);

    expect(ctx).toContain('=== Segment 1');
    expect(ctx).not.toContain('Long video segment');
    expect(ctx).not.toContain('=== Segment 2');
  });

  it('for video > 60 min, caps total context at 200,000 characters', () => {
    const longText = 'x'.repeat(1000);
    const manyEntries = Array.from({ length: 300 }, (_, i) => ({
      timestamp: '01:00:00',
      speaker: 'SPEAKER_00',
      text: longText,
      tone: 'neutral',
    }));

    const p1: Pass1Result = {
      segment_index: 0,
      time_range: '01:00:00 - 01:01:00',
      transcript_entries: manyEntries,
      speaker_summary: [],
    };
    const p2: Pass2Result = { ...VALID_PASS2, segment_index: 0 };

    // 3700 seconds > 3600 = long video
    const ctx = compileContext(3700, [p1], [p2]);

    expect(ctx.length).toBeLessThanOrEqual(200_000);
  });

  it('does not cap context at 200k for short videos even if large', () => {
    const longText = 'x'.repeat(1000);
    const manyEntries = Array.from({ length: 300 }, (_, i) => ({
      timestamp: '00:00:05',
      speaker: 'SPEAKER_00',
      text: longText,
      tone: 'neutral',
    }));

    const p1: Pass1Result = {
      segment_index: 0,
      time_range: '00:00:00 - 00:05:00',
      transcript_entries: manyEntries,
      speaker_summary: [],
    };

    // 300 seconds < 3600 = short video, no cap applied
    const ctx = compileContext(300, [p1], [null]);

    expect(ctx.length).toBeGreaterThan(200_000);
  });
});
