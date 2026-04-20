import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiClient } from './client.js';

// Mock @google/genai so no real network calls happen
vi.mock('@google/genai', () => {
  const mockGenerateContent = vi.fn();
  const GoogleGenAI = vi.fn(() => ({
    models: { generateContent: mockGenerateContent },
  }));
  return { GoogleGenAI, FileState: { ACTIVE: 'ACTIVE', FAILED: 'FAILED' } };
});

async function getGenerateContentMock(): Promise<ReturnType<typeof vi.fn>> {
  const mod = await import('@google/genai');
  const instance = new (mod.GoogleGenAI as ReturnType<typeof vi.fn>)({ apiKey: 'test' });
  return instance.models.generateContent as ReturnType<typeof vi.fn>;
}

function makeResponse(overrides: {
  text?: string;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } | null;
}) {
  return {
    text: overrides.text ?? '{"ok":true}',
    usageMetadata: overrides.usageMetadata !== undefined ? overrides.usageMetadata : {
      promptTokenCount: 0,
      candidatesTokenCount: 0,
    },
  };
}

describe('GeminiClient api call count', () => {
  let client: GeminiClient;
  let mockGenerate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    client = new GeminiClient('test-api-key');
    mockGenerate = await getGenerateContentMock();
    mockGenerate.mockReset();
  });

  it('starts at 0', () => {
    expect(client.getApiCallCount()).toBe(0);
  });

  it('increments by 1 after each generate() call', async () => {
    mockGenerate
      .mockResolvedValueOnce(makeResponse({}))
      .mockResolvedValueOnce(makeResponse({}))
      .mockResolvedValueOnce(makeResponse({}));

    const params = { model: 'm', contents: [], config: {} };
    await client.generate(params);
    expect(client.getApiCallCount()).toBe(1);
    await client.generate(params);
    expect(client.getApiCallCount()).toBe(2);
    await client.generate(params);
    expect(client.getApiCallCount()).toBe(3);
  });

  it('increments even when generate() throws', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('network error'));

    await expect(client.generate({ model: 'm', contents: [], config: {} })).rejects.toThrow();
    expect(client.getApiCallCount()).toBe(1);
  });
});

describe('GeminiClient token usage', () => {
  let client: GeminiClient;
  let mockGenerate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    client = new GeminiClient('test-api-key');
    mockGenerate = await getGenerateContentMock();
    mockGenerate.mockReset();
  });

  it('accumulates token counts across multiple calls', async () => {
    mockGenerate
      .mockResolvedValueOnce(makeResponse({ usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } }))
      .mockResolvedValueOnce(makeResponse({ usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 80 } }))
      .mockResolvedValueOnce(makeResponse({ usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 60 } }));

    const params = { model: 'm', contents: [], config: {} };
    await client.generate(params);
    await client.generate(params);
    await client.generate(params);

    const usage = client.getTokenUsage();
    expect(usage.promptTokens).toBe(450);
    expect(usage.candidatesTokens).toBe(190);
    expect(usage.totalTokens).toBe(640);
  });

  it('skips accumulation when usageMetadata is undefined', async () => {
    mockGenerate.mockResolvedValueOnce(makeResponse({ usageMetadata: undefined }));

    await client.generate({ model: 'm', contents: [], config: {} });

    const usage = client.getTokenUsage();
    expect(usage.promptTokens).toBe(0);
    expect(usage.candidatesTokens).toBe(0);
    expect(usage.totalTokens).toBe(0);
  });

  it('skips accumulation when usageMetadata is null', async () => {
    mockGenerate.mockResolvedValueOnce(makeResponse({ usageMetadata: null }));

    await client.generate({ model: 'm', contents: [], config: {} });

    const usage = client.getTokenUsage();
    expect(usage.promptTokens).toBe(0);
    expect(usage.candidatesTokens).toBe(0);
    expect(usage.totalTokens).toBe(0);
  });

  it('handles missing individual count fields gracefully', async () => {
    mockGenerate.mockResolvedValueOnce(makeResponse({ usageMetadata: {} }));

    await client.generate({ model: 'm', contents: [], config: {} });

    const usage = client.getTokenUsage();
    expect(usage.promptTokens).toBe(0);
    expect(usage.candidatesTokens).toBe(0);
    expect(usage.totalTokens).toBe(0);
  });

  it('getTokenUsage returns a copy, not a reference', async () => {
    mockGenerate.mockResolvedValueOnce(makeResponse({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }));

    await client.generate({ model: 'm', contents: [], config: {} });

    const usage1 = client.getTokenUsage();
    usage1.promptTokens = 9999;

    const usage2 = client.getTokenUsage();
    expect(usage2.promptTokens).toBe(10);
  });

  it('resetTokenUsage resets all counts to zero', async () => {
    mockGenerate.mockResolvedValueOnce(makeResponse({ usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } }));

    await client.generate({ model: 'm', contents: [], config: {} });
    client.resetTokenUsage();

    const usage = client.getTokenUsage();
    expect(usage.promptTokens).toBe(0);
    expect(usage.candidatesTokens).toBe(0);
    expect(usage.totalTokens).toBe(0);
  });

  it('accumulates correctly after reset', async () => {
    mockGenerate
      .mockResolvedValueOnce(makeResponse({ usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } }))
      .mockResolvedValueOnce(makeResponse({ usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 20 } }));

    await client.generate({ model: 'm', contents: [], config: {} });
    client.resetTokenUsage();
    await client.generate({ model: 'm', contents: [], config: {} });

    const usage = client.getTokenUsage();
    expect(usage.promptTokens).toBe(30);
    expect(usage.candidatesTokens).toBe(20);
    expect(usage.totalTokens).toBe(50);
  });

  it('totalTokens equals promptTokens + candidatesTokens', async () => {
    mockGenerate
      .mockResolvedValueOnce(makeResponse({ usageMetadata: { promptTokenCount: 123, candidatesTokenCount: 77 } }))
      .mockResolvedValueOnce(makeResponse({ usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 100 } }));

    await client.generate({ model: 'm', contents: [], config: {} });
    await client.generate({ model: 'm', contents: [], config: {} });

    const usage = client.getTokenUsage();
    expect(usage.totalTokens).toBe(usage.promptTokens + usage.candidatesTokens);
  });
});
