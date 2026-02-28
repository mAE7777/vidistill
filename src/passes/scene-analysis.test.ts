import { describe, it, expect, vi } from 'vitest';
import { MediaResolution } from '@google/genai';
import type { GeminiClient } from '../gemini/client.js';
import { runSceneAnalysis } from './scene-analysis.js';
import type { VideoProfile } from '../types/index.js';

function makeClient(result: unknown): GeminiClient {
  return {
    generate: vi.fn().mockResolvedValue(result),
  } as unknown as GeminiClient;
}

const CODING_PROFILE: VideoProfile = {
  type: 'coding',
  speakers: { count: 1, identified: [] },
  complexity: 'moderate',
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
  recommendations: {
    resolution: 'high',
    segmentMinutes: 10,
    passes: ['transcript', 'visual', 'code', 'synthesis'],
  },
};

const MEETING_PROFILE: VideoProfile = {
  type: 'meeting',
  speakers: { count: 4, identified: ['Alice', 'Bob'] },
  complexity: 'simple',
  visualContent: {
    hasCode: false,
    hasSlides: false,
    hasDiagrams: false,
    hasPeopleGrid: true,
    hasChatbox: true,
    hasWhiteboard: false,
    hasTerminal: false,
    hasScreenShare: false,
  },
  audioContent: {
    hasMultipleSpeakers: true,
    primaryLanguage: 'English',
    quality: 'medium',
  },
  recommendations: {
    resolution: 'medium',
    segmentMinutes: 10,
    passes: ['transcript', 'visual', 'people', 'chat', 'implicit', 'synthesis'],
  },
};

describe('runSceneAnalysis', () => {
  it('returns VideoProfile with type coding and hasCode true for a coding tutorial', async () => {
    const client = makeClient(CODING_PROFILE);
    const result = await runSceneAnalysis({
      client,
      fileUri: 'files/coding-tutorial',
      mimeType: 'video/mp4',
      duration: 600,
      model: 'gemini-2.5-flash',
    });

    expect(result.type).toBe('coding');
    expect(result.visualContent.hasCode).toBe(true);
  });

  it('returns VideoProfile with type meeting and hasPeopleGrid true for a Zoom meeting', async () => {
    const client = makeClient(MEETING_PROFILE);
    const result = await runSceneAnalysis({
      client,
      fileUri: 'files/zoom-meeting',
      mimeType: 'video/mp4',
      duration: 3600,
      model: 'gemini-2.5-flash',
    });

    expect(result.type).toBe('meeting');
    expect(result.visualContent.hasPeopleGrid).toBe(true);
  });

  it('recommendations.passes contains at least transcript and visual for a valid profile', async () => {
    const client = makeClient(CODING_PROFILE);
    const result = await runSceneAnalysis({
      client,
      fileUri: 'files/coding-tutorial',
      mimeType: 'video/mp4',
      duration: 600,
      model: 'gemini-2.5-flash',
    });

    expect(result.recommendations.passes).toContain('transcript');
    expect(result.recommendations.passes).toContain('visual');
  });

  it('uses endOffset equal to duration when video is shorter than 3 minutes', async () => {
    const client = makeClient(CODING_PROFILE);
    const duration = 120; // 2 minutes
    await runSceneAnalysis({
      client,
      fileUri: 'files/short-video',
      mimeType: 'video/mp4',
      duration,
      model: 'gemini-2.5-flash',
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const part = call.contents[0].parts[0];
    expect(part.videoMetadata.startOffset).toBe('0s');
    expect(part.videoMetadata.endOffset).toBe(`${duration}s`);
  });

  it('caps endOffset at 180s for videos longer than 3 minutes', async () => {
    const client = makeClient(CODING_PROFILE);
    await runSceneAnalysis({
      client,
      fileUri: 'files/long-video',
      mimeType: 'video/mp4',
      duration: 600,
      model: 'gemini-2.5-flash',
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const part = call.contents[0].parts[0];
    expect(part.videoMetadata.endOffset).toBe('180s');
  });

  it('uses MEDIA_RESOLUTION_LOW by default when no resolution is provided', async () => {
    const client = makeClient(CODING_PROFILE);
    await runSceneAnalysis({
      client,
      fileUri: 'files/coding-tutorial',
      mimeType: 'video/mp4',
      duration: 300,
      model: 'gemini-2.5-flash',
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.config.mediaResolution).toBe(MediaResolution.MEDIA_RESOLUTION_LOW);
  });

  it('forwards resolution when explicitly provided', async () => {
    const client = makeClient(CODING_PROFILE);
    await runSceneAnalysis({
      client,
      fileUri: 'files/coding-tutorial',
      mimeType: 'video/mp4',
      duration: 300,
      model: 'gemini-2.5-flash',
      resolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.config.mediaResolution).toBe(MediaResolution.MEDIA_RESOLUTION_MEDIUM);
  });

  it('uses maxOutputTokens 8192 and temperature 0.5', async () => {
    const client = makeClient(CODING_PROFILE);
    await runSceneAnalysis({
      client,
      fileUri: 'files/coding-tutorial',
      mimeType: 'video/mp4',
      duration: 300,
      model: 'gemini-2.5-flash',
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.config.maxOutputTokens).toBe(8192);
    expect(call.config.temperature).toBe(0.5);
  });

  it('throws "Empty response from Gemini Pass 0" when type field is missing', async () => {
    const client = makeClient({ confidence: 0.9, complexity: 'low' });

    await expect(
      runSceneAnalysis({ client, fileUri: 'files/x', mimeType: 'video/mp4', duration: 60, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Empty response from Gemini Pass 0');
  });

  it('throws "Empty response from Gemini Pass 0" when result is null', async () => {
    const client = makeClient(null);

    await expect(
      runSceneAnalysis({ client, fileUri: 'files/x', mimeType: 'video/mp4', duration: 60, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Empty response from Gemini Pass 0');
  });

  it('propagates errors thrown by client.generate', async () => {
    const client = {
      generate: vi.fn().mockRejectedValue(new Error('Gemini API error')),
    } as unknown as GeminiClient;

    await expect(
      runSceneAnalysis({ client, fileUri: 'files/x', mimeType: 'video/mp4', duration: 60, model: 'gemini-2.5-flash' }),
    ).rejects.toThrow('Gemini API error');
  });

  it('returns the full VideoProfile object when Gemini returns valid data', async () => {
    const client = makeClient(CODING_PROFILE);
    const result = await runSceneAnalysis({
      client,
      fileUri: 'files/coding-tutorial',
      mimeType: 'video/mp4',
      duration: 600,
      model: 'gemini-2.5-flash',
    });

    expect(result).toEqual(CODING_PROFILE);
  });
});
