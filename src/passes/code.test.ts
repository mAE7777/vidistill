import { describe, it, expect, vi } from 'vitest';
import type { GeminiClient } from '../gemini/client.js';
import { runCodeReconstruction } from './code.js';
import type { Segment, Pass1Result, Pass2Result, CodeReconstruction } from '../types/index.js';

const SEGMENT: Segment = { index: 0, startTime: 0, endTime: 60 };

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
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
    });

    expect(result).toEqual(VALID_RESULT);
  });

  it('throws when result is null', async () => {
    const client = makeClient(null);

    await expect(
      runCodeReconstruction({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Incomplete CodeReconstruction from Gemini Pass 3a');
  });

  it('throws when files field is missing', async () => {
    const client = makeClient({ dependencies_mentioned: [], build_commands: [] });

    await expect(
      runCodeReconstruction({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Incomplete CodeReconstruction from Gemini Pass 3a');
  });

  it('throws when files is not an array', async () => {
    const client = makeClient({ files: 'not-an-array', dependencies_mentioned: [], build_commands: [] });

    await expect(
      runCodeReconstruction({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Incomplete CodeReconstruction from Gemini Pass 3a');
  });

  it('uses placeholder text when pass1Result is undefined', async () => {
    const client = makeClient(VALID_RESULT);
    await runCodeReconstruction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[No transcript available for this segment]');
  });

  it('uses placeholder text when pass2Result is undefined', async () => {
    const client = makeClient(VALID_RESULT);
    await runCodeReconstruction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[No code blocks available for this segment]');
  });

  it('uses placeholder text when pass1Result is null', async () => {
    const client = makeClient(VALID_RESULT);
    await runCodeReconstruction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
      pass1Result: null,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[No transcript available for this segment]');
  });

  it('uses placeholder text when pass2Result is null', async () => {
    const client = makeClient(VALID_RESULT);
    await runCodeReconstruction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
      pass2Result: null,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[No code blocks available for this segment]');
  });

  it('uses placeholder text when pass2Result has empty code_blocks', async () => {
    const client = makeClient(VALID_RESULT);
    await runCodeReconstruction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
      pass2Result: { ...VALID_PASS2, code_blocks: [] },
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[No code blocks available for this segment]');
  });

  it('injects pass1 transcript into prompt text', async () => {
    const client = makeClient(VALID_RESULT);
    await runCodeReconstruction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
      pass1Result: VALID_PASS1,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[00:00:05] SPEAKER_00: Now I will create the main file');
  });

  it('injects pass2 code_blocks into prompt text', async () => {
    const client = makeClient(VALID_RESULT);
    await runCodeReconstruction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
      pass2Result: VALID_PASS2,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[00:00:10] main.py (python):');
    expect(textPart).toContain('def hello():');
  });

  it('forwards resolution when provided', async () => {
    const { MediaResolution } = await import('@google/genai');
    const client = makeClient(VALID_RESULT);
    await runCodeReconstruction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
      resolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
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
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect('mediaResolution' in call.config).toBe(false);
  });

  it('propagates errors thrown by client.generate', async () => {
    const client = {
      generate: vi.fn().mockRejectedValue(new Error('Gemini API error')),
    } as unknown as GeminiClient;

    await expect(
      runCodeReconstruction({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Gemini API error');
  });

  it('includes videoMetadata with correct offsets in contents', async () => {
    const client = makeClient(VALID_RESULT);
    const segment: Segment = { index: 2, startTime: 120, endTime: 180 };
    await runCodeReconstruction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment,
      model: 'gemini-2.5-flash',
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const filePart = call.contents[0].parts[0];
    expect(filePart.videoMetadata.startOffset).toBe('120s');
    expect(filePart.videoMetadata.endOffset).toBe('180s');
  });
});
