import { describe, it, expect, vi } from 'vitest';
import type { GeminiClient } from '../gemini/client.js';
import { runTranscript } from './transcript.js';
import type { Segment, Pass1Result } from '../types/index.js';

const SEGMENT: Segment = { index: 0, startTime: 0, endTime: 60 };

function makeClient(result: unknown): GeminiClient {
  return {
    generate: vi.fn().mockResolvedValue(result),
  } as unknown as GeminiClient;
}

describe('runTranscript', () => {
  it('returns Pass1Result when Gemini returns valid data', async () => {
    const validResult: Pass1Result = {
      segment_index: 0,
      time_range: '00:00:00 - 00:01:00',
      transcript_entries: [
        { timestamp: '00:00:01', speaker: 'SPEAKER_00', text: 'Hello world', tone: 'neutral' },
      ],
      speaker_summary: [{ speaker_id: 'SPEAKER_00', description: 'Main speaker' }],
    };

    const client = makeClient(validResult);
    const result = await runTranscript({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
    });

    expect(result).toEqual(validResult);
  });

  it('throws "Empty response from Gemini Pass 1" when transcript_entries is missing', async () => {
    const client = makeClient({ segment_index: 0, time_range: '00:00:00 - 00:01:00' });

    await expect(
      runTranscript({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Empty response from Gemini Pass 1');
  });

  it('throws "Empty response from Gemini Pass 1" when result is null', async () => {
    const client = makeClient(null);

    await expect(
      runTranscript({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Empty response from Gemini Pass 1');
  });

  it('propagates errors thrown by client.generate (e.g. Gemini-level empty response)', async () => {
    const client = {
      generate: vi.fn().mockRejectedValue(new Error('Gemini returned an empty response')),
    } as unknown as GeminiClient;

    await expect(
      runTranscript({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Gemini returned an empty response');
  });
});
