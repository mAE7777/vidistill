import { describe, it, expect, vi } from 'vitest';
import type { GeminiClient } from '../gemini/client.js';
import { runTranscription } from './transcription.js';
import type { Segment, Pass1aResult } from '../types/index.js';

const SEGMENT: Segment = { index: 0, startTime: 0, endTime: 60 };

function makeClient(result: unknown): GeminiClient {
  return {
    generate: vi.fn().mockResolvedValue(result),
  } as unknown as GeminiClient;
}

describe('runTranscription', () => {
  it('returns Pass1aResult when Gemini returns valid data', async () => {
    const validResult: Pass1aResult = {
      segment_index: 0,
      time_range: '00:00:00 - 00:01:00',
      transcript_entries: [
        { timestamp: '00:00:01', text: 'Hello world', tone: 'neutral' },
      ],
    };

    const client = makeClient(validResult);
    const result = await runTranscription({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
    });

    expect(result).toEqual(validResult);
  });

  it('returns entries without speaker field', async () => {
    const validResult: Pass1aResult = {
      segment_index: 0,
      time_range: '00:00:00 - 00:01:00',
      transcript_entries: [
        { timestamp: '00:00:01', text: 'Hello', tone: 'neutral' },
        { timestamp: '00:00:05', text: 'World', tone: 'emphatic', emphasis_words: ['World'] },
      ],
    };

    const client = makeClient(validResult);
    const result = await runTranscription({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
    });

    for (const entry of result.transcript_entries) {
      expect(entry).not.toHaveProperty('speaker');
    }
  });

  it('throws when transcript_entries is missing', async () => {
    const client = makeClient({ segment_index: 0, time_range: '00:00:00 - 00:01:00' });

    await expect(
      runTranscription({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Empty response from Gemini Pass 1a');
  });

  it('throws when result is null', async () => {
    const client = makeClient(null);

    await expect(
      runTranscription({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Empty response from Gemini Pass 1a');
  });

  it('returns empty transcript_entries for no-speech segment', async () => {
    const emptyResult: Pass1aResult = {
      segment_index: 0,
      time_range: '00:00:00 - 00:01:00',
      transcript_entries: [],
    };

    const client = makeClient(emptyResult);
    const result = await runTranscription({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
    });

    expect(result.transcript_entries).toEqual([]);
  });

  it('propagates errors thrown by client.generate', async () => {
    const client = {
      generate: vi.fn().mockRejectedValue(new Error('Gemini returned an empty response')),
    } as unknown as GeminiClient;

    await expect(
      runTranscription({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Gemini returned an empty response');
  });

  it('passes language parameter via withLanguage', async () => {
    const validResult: Pass1aResult = {
      segment_index: 0,
      time_range: '00:00:00 - 00:01:00',
      transcript_entries: [],
    };

    const client = makeClient(validResult);
    await runTranscription({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
      lang: 'zh',
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.config.systemInstruction).toContain('Chinese');
  });
});
