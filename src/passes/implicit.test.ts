import { describe, it, expect, vi } from 'vitest';
import type { GeminiClient } from '../gemini/client.js';
import { runImplicitSignals } from './implicit.js';
import type { Segment, Pass1Result, Pass2Result, ImplicitSignals } from '../types/index.js';

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
    { timestamp: '00:00:05', speaker: 'SPEAKER_00', text: 'We really need to ship this feature.', tone: 'emphatic' },
    { timestamp: '00:00:20', speaker: 'SPEAKER_01', text: 'Sure, I can take a look at that.', tone: 'conversational' },
  ],
  speaker_summary: [
    { speaker_id: 'SPEAKER_00', description: 'Host' },
    { speaker_id: 'SPEAKER_01', description: 'Engineer' },
  ],
};

const VALID_PASS2: Pass2Result = {
  segment_index: 0,
  time_range: '00:00:00 - 00:01:00',
  code_blocks: [],
  visual_notes: [
    { timestamp: '00:00:10', visual_type: 'slide', description: 'Q4 roadmap slide showing deadline' },
  ],
  screen_timeline: [],
};

const VALID_RESULT: ImplicitSignals = {
  emotional_shifts: [
    {
      timestamp: '00:00:05',
      from_state: 'calm',
      to_state: 'urgent',
      trigger: 'Mention of shipping deadline',
    },
  ],
  questions_implicit: ['Is the feature actually ready to ship?'],
  decisions_implicit: ['SPEAKER_01 will handle the feature'],
  tasks_assigned: [
    {
      timestamp: '00:00:20',
      assignee: 'SPEAKER_01',
      task: 'Look at the feature implementation',
      deadline: '',
    },
  ],
  emphasis_patterns: [
    {
      concept: 'shipping',
      times_mentioned: 2,
      timestamps: ['00:00:05', '00:00:30'],
      significance: 'Repeated mention signals urgency around release timeline',
    },
  ],
};

describe('runImplicitSignals', () => {
  it('returns ImplicitSignals when Gemini returns valid data', async () => {
    const client = makeClient(VALID_RESULT);
    const result = await runImplicitSignals({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-3-flash-preview',
    });

    expect(result).toEqual(VALID_RESULT);
  });

  it('throws when result is null', async () => {
    const client = makeClient(null);

    await expect(
      runImplicitSignals({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-3-flash-preview' }),
    ).rejects.toThrow('Incomplete ImplicitSignals from Gemini Pass 3d');
  });

  it('throws when emotional_shifts field is missing', async () => {
    const client = makeClient({ tasks_assigned: [], emphasis_patterns: [] });

    await expect(
      runImplicitSignals({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-3-flash-preview' }),
    ).rejects.toThrow('Incomplete ImplicitSignals from Gemini Pass 3d');
  });

  it('throws when emotional_shifts is not an array', async () => {
    const client = makeClient({ emotional_shifts: 'not-an-array', tasks_assigned: [], emphasis_patterns: [] });

    await expect(
      runImplicitSignals({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-3-flash-preview' }),
    ).rejects.toThrow('Incomplete ImplicitSignals from Gemini Pass 3d');
  });

  it('uses transcript placeholder when pass1Result is undefined', async () => {
    const client = makeClient(VALID_RESULT);
    await runImplicitSignals({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-3-flash-preview',
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[No transcript available for this segment]');
  });

  it('uses transcript placeholder when pass1Result is null', async () => {
    const client = makeClient(VALID_RESULT);
    await runImplicitSignals({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-3-flash-preview',
      pass1Result: null,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[No transcript available for this segment]');
  });

  it('uses visual notes placeholder when pass2Result is undefined', async () => {
    const client = makeClient(VALID_RESULT);
    await runImplicitSignals({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-3-flash-preview',
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[No visual context available for this segment]');
  });

  it('uses visual notes placeholder when pass2Result is null', async () => {
    const client = makeClient(VALID_RESULT);
    await runImplicitSignals({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-3-flash-preview',
      pass2Result: null,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[No visual context available for this segment]');
  });

  it('injects pass1 transcript with tone into prompt text', async () => {
    const client = makeClient(VALID_RESULT);
    await runImplicitSignals({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-3-flash-preview',
      pass1Result: VALID_PASS1,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[00:00:05] SPEAKER_00 (emphatic): We really need to ship this feature.');
    expect(textPart).toContain('[00:00:20] SPEAKER_01 (conversational): Sure, I can take a look at that.');
  });

  it('injects pass2 visual_notes into prompt text', async () => {
    const client = makeClient(VALID_RESULT);
    await runImplicitSignals({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-3-flash-preview',
      pass2Result: VALID_PASS2,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const textPart = call.contents[0].parts[1].text as string;
    expect(textPart).toContain('[00:00:10] slide: Q4 roadmap slide showing deadline');
  });

  it('includes videoMetadata with correct offsets in contents', async () => {
    const client = makeClient(VALID_RESULT);
    const segment: Segment = { index: 2, startTime: 120, endTime: 180 };
    await runImplicitSignals({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment,
      model: 'gemini-3-flash-preview',
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const filePart = call.contents[0].parts[0];
    expect(filePart.videoMetadata.startOffset).toBe('120s');
    expect(filePart.videoMetadata.endOffset).toBe('180s');
  });

  it('forwards resolution when provided', async () => {
    const { MediaResolution } = await import('@google/genai');
    const client = makeClient(VALID_RESULT);
    await runImplicitSignals({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-3-flash-preview',
      resolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.config.mediaResolution).toBe(MediaResolution.MEDIA_RESOLUTION_MEDIUM);
  });

  it('omits resolution from config when not provided', async () => {
    const client = makeClient(VALID_RESULT);
    await runImplicitSignals({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-3-flash-preview',
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect('mediaResolution' in call.config).toBe(false);
  });

  it('propagates errors thrown by client.generate', async () => {
    const client = {
      generate: vi.fn().mockRejectedValue(new Error('Gemini API error')),
    } as unknown as GeminiClient;

    await expect(
      runImplicitSignals({ client, fileUri: 'files/x', mimeType: 'video/mp4', segment: SEGMENT, model: 'gemini-3-flash-preview' }),
    ).rejects.toThrow('Gemini API error');
  });

  it('captures emotional shift fields: from_state, to_state, trigger', async () => {
    const client = makeClient(VALID_RESULT);
    const result = await runImplicitSignals({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-3-flash-preview',
    });

    expect(result.emotional_shifts[0].from_state).toBe('calm');
    expect(result.emotional_shifts[0].to_state).toBe('urgent');
    expect(result.emotional_shifts[0].trigger).toBe('Mention of shipping deadline');
  });

  it('captures task assigned fields: assignee, task, deadline', async () => {
    const client = makeClient(VALID_RESULT);
    const result = await runImplicitSignals({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-3-flash-preview',
    });

    expect(result.tasks_assigned[0].assignee).toBe('SPEAKER_01');
    expect(result.tasks_assigned[0].task).toBe('Look at the feature implementation');
    expect(result.tasks_assigned[0].deadline).toBe('');
  });

  it('captures emphasis pattern times_mentioned count', async () => {
    const client = makeClient(VALID_RESULT);
    const result = await runImplicitSignals({
      client,
      fileUri: 'files/abc123',
      mimeType: 'video/mp4',
      segment: SEGMENT,
      model: 'gemini-3-flash-preview',
    });

    expect(result.emphasis_patterns[0].times_mentioned).toBe(2);
  });
});
