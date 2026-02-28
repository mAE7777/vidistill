import { describe, it, expect, vi } from 'vitest';
import type { GeminiClient } from '../gemini/client.js';
import { runVisual } from './visual.js';
import type { Segment, Pass1Result, Pass2Result } from '../types/index.js';

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
    { timestamp: '00:00:01', speaker: 'SPEAKER_00', text: 'Hello world', tone: 'neutral' },
  ],
  speaker_summary: [{ speaker_id: 'SPEAKER_00', description: 'Main speaker' }],
};

const VALID_RESULT: Pass2Result = {
  segment_index: 0,
  time_range: '00:00:00 - 00:01:00',
  code_blocks: [],
  visual_notes: [],
  screen_timeline: [],
};

describe('runVisual', () => {
  it('returns Pass2Result when Gemini returns valid data', async () => {
    const client = makeClient(VALID_RESULT);
    const result = await runVisual({
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
      runVisual({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Empty response from Gemini Pass 2');
  });

  it('throws when code_blocks is missing', async () => {
    const client = makeClient({ segment_index: 0, time_range: '0-60' });

    await expect(
      runVisual({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Empty response from Gemini Pass 2');
  });

  it('throws when code_blocks is not an array', async () => {
    const client = makeClient({ code_blocks: 'not-an-array' });

    await expect(
      runVisual({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Empty response from Gemini Pass 2');
  });

  it('uses placeholder text when pass1Transcript is undefined', async () => {
    const client = makeClient(VALID_RESULT);
    await runVisual({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.config.systemInstruction).toContain('[No transcript available for this segment]');
  });

  it('injects pass1 transcript text into system instruction', async () => {
    const client = makeClient(VALID_RESULT);
    await runVisual({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
      pass1Transcript: VALID_PASS1,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.config.systemInstruction).toContain('[00:00:01] SPEAKER_00: Hello world');
  });

  it('forwards resolution when provided', async () => {
    const { MediaResolution } = await import('@google/genai');
    const client = makeClient(VALID_RESULT);
    await runVisual({
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
    await runVisual({
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
      runVisual({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Gemini API error');
  });
});
