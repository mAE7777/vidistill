import { describe, it, expect, vi } from 'vitest';
import type { GeminiClient } from '../gemini/client.js';
import { runChatExtraction } from './chat.js';
import type { Segment, Pass2Result, ChatExtraction } from '../types/index.js';

const SEGMENT: Segment = { index: 0, startTime: 0, endTime: 60 };

function makeClient(result: unknown): GeminiClient {
  return {
    generate: vi.fn().mockResolvedValue(result),
  } as unknown as GeminiClient;
}

const VALID_PASS2: Pass2Result = {
  segment_index: 0,
  time_range: '00:00:00 - 00:01:00',
  code_blocks: [],
  visual_notes: [
    { timestamp: '00:00:05', visual_type: 'other', description: 'Chat panel showing messages from attendees' },
  ],
  visual_regions: [
    {
      timestamp: '00:00:05',
      region_type: 'chat',
      label: 'Join the conversation',
      bbox: { x: 0.68, y: 0.1, width: 0.28, height: 0.8 },
      visible: true,
      sample_text: 'Alice: Hello everyone!',
      confidence: 0.96,
    },
  ],
  screen_timeline: [],
};

const VALID_RESULT: ChatExtraction = {
  messages: [
    { timestamp: '00:00:05', sender: 'Alice', text: 'Hello everyone!' },
    { timestamp: '00:00:15', sender: 'Bob', text: 'Check out https://example.com' },
  ],
  links: [
    { url: 'https://example.com', context: 'Shared by Bob in chat', timestamp: '00:00:15' },
  ],
};

describe('runChatExtraction', () => {
  it('returns ChatExtraction when Gemini returns valid data', async () => {
    const client = makeClient(VALID_RESULT);
    const result = await runChatExtraction({
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
      runChatExtraction({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Incomplete ChatExtraction from Gemini Pass 3c');
  });

  it('throws when messages field is missing', async () => {
    const client = makeClient({ links: [] });

    await expect(
      runChatExtraction({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Incomplete ChatExtraction from Gemini Pass 3c');
  });

  it('throws when messages is not an array', async () => {
    const client = makeClient({ messages: 'not-an-array', links: [] });

    await expect(
      runChatExtraction({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Incomplete ChatExtraction from Gemini Pass 3c');
  });

  it('uses visual notes placeholder when pass2Result is undefined', async () => {
    const client = makeClient(VALID_RESULT);
    await runChatExtraction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[No visual context available for this segment]');
  });

  it('uses visual notes placeholder when pass2Result is null', async () => {
    const client = makeClient(VALID_RESULT);
    await runChatExtraction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
      pass2Result: null,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[No visual context available for this segment]');
  });

  it('uses visual notes placeholder when pass2Result has empty visual_notes', async () => {
    const client = makeClient(VALID_RESULT);
    await runChatExtraction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
      pass2Result: { ...VALID_PASS2, visual_notes: [] },
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[No visual context available for this segment]');
  });

  it('injects pass2 visual_notes into prompt text', async () => {
    const client = makeClient(VALID_RESULT);
    await runChatExtraction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
      pass2Result: VALID_PASS2,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[00:00:05] other: Chat panel showing messages from attendees');
  });

  it('injects pass2 visual_regions as focus regions into prompt text', async () => {
    const client = makeClient(VALID_RESULT);
    await runChatExtraction({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-2.5-flash',
      pass2Result: VALID_PASS2,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('DETECTED VISUAL REGIONS FROM THIS SEGMENT');
    expect(textPart).toContain('[00:00:05] chat: Join the conversation');
    expect(textPart).toContain('FOCUS_CHAT_REGION');
    expect(textPart).toContain('sample: Alice: Hello everyone!');
  });

  it('includes videoMetadata with correct offsets in contents', async () => {
    const client = makeClient(VALID_RESULT);
    const segment: Segment = { index: 2, startTime: 120, endTime: 180 };
    await runChatExtraction({
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

  it('forwards resolution when provided', async () => {
    const { MediaResolution } = await import('@google/genai');
    const client = makeClient(VALID_RESULT);
    await runChatExtraction({
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
    await runChatExtraction({
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
      runChatExtraction({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Gemini API error');
  });
});
