import { describe, it, expect, vi } from 'vitest';
import type { GeminiClient } from '../gemini/client.js';
import { runPeopleExtraction } from './people.js';
import type { Pass1Result, PeopleExtraction } from '../types/index.js';

function makeClient(result: unknown): GeminiClient {
  return {
    generate: vi.fn().mockResolvedValue(result),
  } as unknown as GeminiClient;
}

const VALID_PASS1_A: Pass1Result = {
  segment_index: 0,
  time_range: '00:00:00 - 00:10:00',
  transcript_entries: [
    { timestamp: '00:00:05', speaker: 'SPEAKER_00', text: 'Hi, I am Alice from Acme Corp', tone: 'neutral' },
    { timestamp: '00:00:15', speaker: 'SPEAKER_01', text: 'And I am Bob, the project lead', tone: 'neutral' },
  ],
  speaker_summary: [
    { speaker_id: 'SPEAKER_00', description: 'Alice' },
    { speaker_id: 'SPEAKER_01', description: 'Bob' },
  ],
};

const VALID_PASS1_B: Pass1Result = {
  segment_index: 1,
  time_range: '00:10:00 - 00:20:00',
  transcript_entries: [
    { timestamp: '00:10:05', speaker: 'SPEAKER_00', text: 'My email is alice@acme.com', tone: 'neutral' },
  ],
  speaker_summary: [],
};

const VALID_RESULT: PeopleExtraction = {
  participants: [
    {
      name: 'Alice',
      role: 'Engineer',
      organization: 'Acme Corp',
      speaking_segments: ['00:00:05', '00:10:05'],
      contact_info: ['alice@acme.com'],
      contributions: ['Introduced herself', 'Shared contact email'],
    },
    {
      name: 'Bob',
      role: 'Project Lead',
      organization: '',
      speaking_segments: ['00:00:15'],
      contact_info: [],
      contributions: ['Introduced himself as project lead'],
    },
  ],
  relationships: ['Alice and Bob are co-presenters'],
};

describe('runPeopleExtraction', () => {
  it('returns PeopleExtraction when Gemini returns valid data', async () => {
    const client = makeClient(VALID_RESULT);
    const result = await runPeopleExtraction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      model: 'gemini-3-flash-preview',
      pass1Results: [VALID_PASS1_A],
    });

    expect(result).toEqual(VALID_RESULT);
  });

  it('throws when result is null', async () => {
    const client = makeClient(null);

    await expect(
      runPeopleExtraction({
        client,
        fileUri: 'files/x',
        mimeType: 'video/mp4',
        model: 'gemini-3-flash-preview',
        pass1Results: [],
      }),
    ).rejects.toThrow('Incomplete PeopleExtraction from Gemini Pass 3b');
  });

  it('throws when participants field is missing', async () => {
    const client = makeClient({ relationships: [] });

    await expect(
      runPeopleExtraction({
        client,
        fileUri: 'files/x',
        mimeType: 'video/mp4',
        model: 'gemini-3-flash-preview',
        pass1Results: [],
      }),
    ).rejects.toThrow('Incomplete PeopleExtraction from Gemini Pass 3b');
  });

  it('throws when participants is not an array', async () => {
    const client = makeClient({ participants: 'not-an-array', relationships: [] });

    await expect(
      runPeopleExtraction({
        client,
        fileUri: 'files/x',
        mimeType: 'video/mp4',
        model: 'gemini-3-flash-preview',
        pass1Results: [],
      }),
    ).rejects.toThrow('Incomplete PeopleExtraction from Gemini Pass 3b');
  });

  it('uses placeholder when all pass1Results are null', async () => {
    const client = makeClient(VALID_RESULT);
    await runPeopleExtraction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      model: 'gemini-3-flash-preview',
      pass1Results: [null, null],
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[No transcript available]');
  });

  it('uses placeholder when pass1Results is empty', async () => {
    const client = makeClient(VALID_RESULT);
    await runPeopleExtraction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      model: 'gemini-3-flash-preview',
      pass1Results: [],
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[No transcript available]');
  });

  it('injects transcript from all pass1 segments into prompt', async () => {
    const client = makeClient(VALID_RESULT);
    await runPeopleExtraction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      model: 'gemini-3-flash-preview',
      pass1Results: [VALID_PASS1_A, VALID_PASS1_B],
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[00:00:05] SPEAKER_00: Hi, I am Alice from Acme Corp');
    expect(textPart).toContain('[00:00:15] SPEAKER_01: And I am Bob, the project lead');
    expect(textPart).toContain('[00:10:05] SPEAKER_00: My email is alice@acme.com');
  });

  it('skips null entries in pass1Results when building transcript', async () => {
    const client = makeClient(VALID_RESULT);
    await runPeopleExtraction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      model: 'gemini-3-flash-preview',
      pass1Results: [null, VALID_PASS1_B, null],
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[00:10:05] SPEAKER_00: My email is alice@acme.com');
    expect(textPart).not.toContain('[No transcript available]');
  });

  it('does not include videoMetadata in contents (processes entire video)', async () => {
    const client = makeClient(VALID_RESULT);
    await runPeopleExtraction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      model: 'gemini-3-flash-preview',
      pass1Results: [VALID_PASS1_A],
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const filePart = call.contents[0].parts[0];
    expect('videoMetadata' in filePart).toBe(false);
    expect(filePart.fileData.fileUri).toBe('files/abc123');
    expect(filePart.fileData.mimeType).toBe('video/mp4');
  });

  it('passes correct model and config to client.generate', async () => {
    const client = makeClient(VALID_RESULT);
    await runPeopleExtraction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      model: 'gemini-3-flash-preview',
      pass1Results: [],
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.model).toBe('gemini-3-flash-preview');
    expect(call.config.responseMimeType).toBe('application/json');
    expect(call.config.maxOutputTokens).toBe(65536);
    expect(call.config.temperature).toBe(1.0);
  });

  it('propagates errors thrown by client.generate', async () => {
    const client = {
      generate: vi.fn().mockRejectedValue(new Error('Gemini API error')),
    } as unknown as GeminiClient;

    await expect(
      runPeopleExtraction({
        client,
        fileUri: 'files/x',
        mimeType: 'video/mp4',
        model: 'gemini-3-flash-preview',
        pass1Results: [],
      }),
    ).rejects.toThrow('Gemini API error');
  });

  it('prompt text begins with "Analyze the entire video."', async () => {
    const client = makeClient(VALID_RESULT);
    await runPeopleExtraction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      model: 'gemini-3-flash-preview',
      pass1Results: [],
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toMatch(/^Analyze the entire video\./);
  });
});
