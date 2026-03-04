import { describe, it, expect, vi } from 'vitest';
import type { GeminiClient } from '../gemini/client.js';
import { runDiarization } from './diarization.js';
import type { Segment, Pass1aResult, Pass1bResult } from '../types/index.js';

const SEGMENT: Segment = { index: 0, startTime: 0, endTime: 60 };

const PASS1A_RESULT: Pass1aResult = {
  segment_index: 0,
  time_range: '00:00:00 - 00:01:00',
  transcript_entries: [
    { timestamp: '00:00:01', text: 'Hello everyone', tone: 'neutral' },
    { timestamp: '00:00:05', text: 'Welcome to the meeting', tone: 'instructional' },
    { timestamp: '00:00:10', text: 'Thanks for having me', tone: 'conversational' },
  ],
};

const EMPTY_PASS1A: Pass1aResult = {
  segment_index: 0,
  time_range: '00:00:00 - 00:01:00',
  transcript_entries: [],
};

function makeClient(result: unknown): GeminiClient {
  return {
    generate: vi.fn().mockResolvedValue(result),
  } as unknown as GeminiClient;
}

describe('runDiarization', () => {
  it('returns Pass1bResult with speaker assignments matching 1a timestamps', async () => {
    const validResult: Pass1bResult = {
      speaker_assignments: [
        { timestamp: '00:00:01', speaker: 'SPEAKER_00' },
        { timestamp: '00:00:05', speaker: 'SPEAKER_00' },
        { timestamp: '00:00:10', speaker: 'SPEAKER_01' },
      ],
      speaker_summary: [
        { speaker_id: 'SPEAKER_00', description: 'Male voice, primary presenter' },
        { speaker_id: 'SPEAKER_01', description: 'Female voice, guest' },
      ],
    };

    const client = makeClient(validResult);
    const result = await runDiarization({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
      pass1aResult: PASS1A_RESULT,
    });

    expect(result.speaker_assignments).toHaveLength(3);
    expect(result.speaker_summary).toHaveLength(2);
  });

  it('includes speaker names when detected', async () => {
    const result: Pass1bResult = {
      speaker_assignments: [
        { timestamp: '00:00:01', speaker: 'SPEAKER_00 (Alice)' },
        { timestamp: '00:00:10', speaker: 'SPEAKER_01 (Bob)' },
      ],
      speaker_summary: [
        { speaker_id: 'SPEAKER_00 (Alice)', description: 'Host' },
        { speaker_id: 'SPEAKER_01 (Bob)', description: 'Guest' },
      ],
    };

    const client = makeClient(result);
    const res = await runDiarization({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
      pass1aResult: PASS1A_RESULT,
    });

    expect(res.speaker_assignments[0].speaker).toBe('SPEAKER_00 (Alice)');
  });

  it('returns empty arrays when 1a transcript is empty', async () => {
    const emptyResult: Pass1bResult = {
      speaker_assignments: [],
      speaker_summary: [],
    };

    const client = makeClient(emptyResult);
    const result = await runDiarization({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
      pass1aResult: EMPTY_PASS1A,
    });

    expect(result.speaker_assignments).toEqual([]);
    expect(result.speaker_summary).toEqual([]);
  });

  it('injects 1a transcript into the prompt', async () => {
    const validResult: Pass1bResult = {
      speaker_assignments: [],
      speaker_summary: [],
    };

    const client = makeClient(validResult);
    await runDiarization({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
      pass1aResult: PASS1A_RESULT,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.config.systemInstruction).toContain('[00:00:01] Hello everyone');
    expect(call.config.systemInstruction).toContain('[00:00:05] Welcome to the meeting');
  });

  it('injects placeholder when 1a transcript is empty', async () => {
    const validResult: Pass1bResult = {
      speaker_assignments: [],
      speaker_summary: [],
    };

    const client = makeClient(validResult);
    await runDiarization({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
      pass1aResult: EMPTY_PASS1A,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.config.systemInstruction).toContain('[No transcript entries in this segment]');
  });

  it('throws when speaker_assignments is missing', async () => {
    const client = makeClient({ speaker_summary: [] });

    await expect(
      runDiarization({
        client,
        fileUri: 'files/x',
        mimeType: 'video/mp4',
        segment: SEGMENT,
        model: 'gemini-2.5-flash',
        pass1aResult: PASS1A_RESULT,
      }),
    ).rejects.toThrow('Empty response from Gemini Pass 1b');
  });

  it('propagates errors thrown by client.generate', async () => {
    const client = {
      generate: vi.fn().mockRejectedValue(new Error('Gemini API error')),
    } as unknown as GeminiClient;

    await expect(
      runDiarization({
        client,
        fileUri: 'files/x',
        mimeType: 'video/mp4',
        segment: SEGMENT,
        model: 'gemini-2.5-flash',
        pass1aResult: PASS1A_RESULT,
      }),
    ).rejects.toThrow('Gemini API error');
  });
});
