import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateOutput, reRenderWithSpeakerMapping, slugify } from './generator.js';
import type { GenerateOutputParams, PipelineResult } from '../types/index.js';

// ---------------------------------------------------------------------------
// fs/promises mock
// ---------------------------------------------------------------------------
const METADATA_JSON = JSON.stringify({
  videoTitle: 'Test Video',
  source: 'https://example.com/video',
  duration: 600,
  model: 'gemini-pro',
  processingTimeMs: 1000,
  filesGenerated: ['transcript.md', 'notes.md', 'people.md', 'chat.md', 'action-items.md', 'timeline.html', 'guide.md', 'raw/pass1-seg0.json'],
  passesRun: ['pass1'],
  errors: [],
});

const PASS1_SEG0_JSON = JSON.stringify({
  segment_index: 0,
  time_range: '0:00-10:00',
  transcript_entries: [{ timestamp: '0:01', speaker: 'SPEAKER_00', text: 'Hello', tone: 'neutral' }],
  speaker_summary: [{ speaker_id: 'SPEAKER_00', description: 'Instructor' }],
});

vi.mock('fs/promises', () => {
  const readFileMock = vi.fn().mockImplementation((path: string) => {
    if (path.endsWith('metadata.json')) return Promise.resolve(METADATA_JSON);
    if (path.endsWith('pass1-seg0.json')) return Promise.resolve(PASS1_SEG0_JSON);
    return Promise.reject(new Error('ENOENT'));
  });
  return {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: readFileMock,
  };
});

// ---------------------------------------------------------------------------
// Writer mocks — return deterministic strings so we can verify calls
// ---------------------------------------------------------------------------
vi.mock('./guide.js', () => ({ writeGuide: vi.fn(() => '# Guide') }));
vi.mock('./transcript.js', () => ({ writeTranscript: vi.fn(() => '# Transcript') }));
vi.mock('./combined.js', () => ({ writeCombined: vi.fn(() => '# Combined') }));
vi.mock('./code-writer.js', () => ({
  writeCodeFiles: vi.fn(() => ({
    files: new Map([['index.ts', 'const x = 1;']]),
    timeline: '# Timeline',
  })),
}));
vi.mock('./notes.js', () => ({ writeNotes: vi.fn(() => '# Notes') }));
vi.mock('./people.js', () => ({ writePeople: vi.fn(() => '# People') }));
vi.mock('./chat.js', () => ({ writeChat: vi.fn(() => '# Chat') }));
vi.mock('./links.js', () => ({ writeLinks: vi.fn(() => '# Links') }));
vi.mock('./action-items.js', () => ({ writeActionItems: vi.fn(() => '# Action Items') }));
vi.mock('./metadata.js', () => ({
  writeMetadata: vi.fn(() => '{}'),
  writeRawOutput: vi.fn(() => new Map([['pass1-seg0.json', '{}']])),
}));

import { mkdir, writeFile } from 'fs/promises';
import { writeCodeFiles } from './code-writer.js';

const mockWriteCodeFiles = vi.mocked(writeCodeFiles);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalPipelineResult(): PipelineResult {
  return {
    segments: [{ index: 0, pass1: null, pass2: null }],
    passesRun: ['pass1'],
    errors: [],
  };
}

function makeFullPipelineResult(): PipelineResult {
  return {
    segments: [
      {
        index: 0,
        pass1: {
          segment_index: 0,
          time_range: '0:00-1:00',
          transcript_entries: [],
          speaker_summary: [],
        },
        pass2: {
          segment_index: 0,
          time_range: '0:00-1:00',
          code_blocks: [],
          visual_notes: [],
          screen_timeline: [],
        },
        pass3c: { messages: [], links: [] },
        pass3d: {
          emotional_shifts: [],
          questions_implicit: [],
          decisions_implicit: [],
          tasks_assigned: [],
          emphasis_patterns: [],
        },
      },
    ],
    passesRun: ['pass1', 'pass2', 'pass3a', 'pass3c', 'pass3d', 'synthesis'],
    errors: [],
    codeReconstruction: { files: [], dependencies_mentioned: [], build_commands: [] },
    synthesisResult: {
      overview: 'Overview',
      key_decisions: [],
      key_concepts: [],
      action_items: [],
      questions_raised: [],
      suggestions: [],
      topics: [],
      files_to_generate: ['guide.md', 'transcript.md', 'code/', 'combined.md'],
      prerequisites: [],
    },
    peopleExtraction: { participants: [], relationships: [] },
  };
}

function makeParams(overrides: Partial<GenerateOutputParams> = {}): GenerateOutputParams {
  return {
    pipelineResult: makeMinimalPipelineResult(),
    outputDir: '/tmp/output',
    videoTitle: 'My Test Video',
    source: 'https://youtube.com/watch?v=abc',
    duration: 600,
    model: 'gemini-pro',
    processingTimeMs: 1234,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// slugify tests
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('lowercases input', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('replaces spaces with hyphens', () => {
    expect(slugify('my video title')).toBe('my-video-title');
  });

  it('replaces special characters with hyphens', () => {
    expect(slugify('Hello, World! (2024)')).toBe('hello-world-2024');
  });

  it('collapses multiple separators', () => {
    expect(slugify('Hello   World')).toBe('hello-world');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  --Hello World--  ')).toBe('hello-world');
  });

  it('truncates to 100 chars', () => {
    const long = 'a'.repeat(200);
    expect(slugify(long).length).toBe(100);
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });

  it('handles numbers', () => {
    expect(slugify('Video 123')).toBe('video-123');
  });
});

// ---------------------------------------------------------------------------
// generateOutput tests
// ---------------------------------------------------------------------------

describe('generateOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the output directory using slugified title', async () => {
    const params = makeParams({ videoTitle: 'My Test Video', outputDir: '/tmp/output' });
    await generateOutput(params);

    expect(mkdir).toHaveBeenCalledWith('/tmp/output/my-test-video', { recursive: true });
  });

  it('always generates transcript.md, metadata.json, guide.md, and raw/', async () => {
    const params = makeParams();
    const result = await generateOutput(params);

    expect(result.filesGenerated).toContain('transcript.md');
    expect(result.filesGenerated).toContain('metadata.json');
    expect(result.filesGenerated).toContain('guide.md');
    // raw/ directory itself is not listed as a file, but raw files are
    expect(result.filesGenerated.some((f) => f.startsWith('raw/'))).toBe(true);
  });

  it('returns the correct outputDir', async () => {
    const params = makeParams({ videoTitle: 'Cool Video', outputDir: '/tmp/vidistill' });
    const result = await generateOutput(params);

    expect(result.outputDir).toBe('/tmp/vidistill/cool-video');
  });

  it('returns empty errors array on success', async () => {
    const params = makeParams();
    const result = await generateOutput(params);

    expect(result.errors).toEqual([]);
  });

  it('writes files to disk via writeFile', async () => {
    const params = makeParams();
    await generateOutput(params);

    // writeFile should have been called at least for transcript, metadata, guide
    expect(writeFile).toHaveBeenCalled();
    const calls = (writeFile as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string]>;
    const writtenPaths = calls.map((c) => c[0]);
    expect(writtenPaths.some((p) => p.endsWith('transcript.md'))).toBe(true);
    expect(writtenPaths.some((p) => p.endsWith('metadata.json'))).toBe(true);
    expect(writtenPaths.some((p) => p.endsWith('guide.md'))).toBe(true);
  });

  it('routes files deterministically from pass data, ignoring files_to_generate', async () => {
    const pipelineResult = makeFullPipelineResult();
    // files_to_generate says only: guide.md, transcript.md, code/, combined.md
    // but pass data has pass2, pass3a, pass3c, pass3d, synthesisResult, peopleExtraction
    // so deterministic routing must produce ALL optional files regardless
    const params = makeParams({ pipelineResult });
    const result = await generateOutput(params);

    // pass2 present → combined.md
    expect(result.filesGenerated).toContain('combined.md');
    // pass3a present → code/
    expect(result.filesGenerated).toContain('code/index.ts');
    expect(result.filesGenerated).toContain('code/code-timeline.md');
    // pass3c present → chat.md, links.md
    expect(result.filesGenerated).toContain('chat.md');
    expect(result.filesGenerated).toContain('links.md');
    // pass3d present → action-items.md
    expect(result.filesGenerated).toContain('action-items.md');
    // synthesisResult present → notes.md
    expect(result.filesGenerated).toContain('notes.md');
    // peopleExtraction present → people.md
    expect(result.filesGenerated).toContain('people.md');
  });

  it('overwrites files if output directory already exists (mkdir recursive does not throw)', async () => {
    // mkdir with recursive:true should not throw even if dir exists
    (mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const params = makeParams();
    await expect(generateOutput(params)).resolves.not.toThrow();
  });

  it('collects errors and continues when a writer throws', async () => {
    const { writeTranscript } = await import('./transcript.js');
    (writeTranscript as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('transcript failure');
    });

    const params = makeParams();
    const result = await generateOutput(params);

    // Error captured
    expect(result.errors.some((e) => e.includes('transcript.md'))).toBe(true);
    // Other files still generated
    expect(result.filesGenerated).toContain('guide.md');
    expect(result.filesGenerated).toContain('metadata.json');
  });

  it('collects errors and continues when writeFile throws', async () => {
    (writeFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));

    const params = makeParams();
    const result = await generateOutput(params);

    // Should have collected an error, but not thrown
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('writes guide.md last (its filename appears after metadata.json in filesGenerated)', async () => {
    const params = makeParams();
    const result = await generateOutput(params);

    const metaIdx = result.filesGenerated.indexOf('metadata.json');
    const guideIdx = result.filesGenerated.indexOf('guide.md');
    expect(metaIdx).toBeGreaterThan(-1);
    expect(guideIdx).toBeGreaterThan(-1);
    expect(guideIdx).toBeGreaterThan(metaIdx);
  });

  it('uses fallback file selection when no synthesis result', async () => {
    const pipelineResult: PipelineResult = {
      segments: [
        {
          index: 0,
          pass1: { segment_index: 0, time_range: '0:00-1:00', transcript_entries: [], speaker_summary: [] },
          pass2: { segment_index: 0, time_range: '0:00-1:00', code_blocks: [], visual_notes: [], screen_timeline: [] },
          pass3c: { messages: [{ timestamp: '0:01', sender: 'Alice', text: 'hi' }], links: [] },
          pass3d: {
            emotional_shifts: [],
            questions_implicit: ['What?'],
            decisions_implicit: [],
            tasks_assigned: [],
            emphasis_patterns: [],
          },
        },
      ],
      passesRun: ['pass1', 'pass2', 'pass3c', 'pass3d'],
      errors: [],
    };

    const params = makeParams({ pipelineResult });
    const result = await generateOutput(params);

    // With no synthesis, combined.md should be generated (has pass2)
    expect(result.filesGenerated).toContain('combined.md');
    // chat.md and links.md (has pass3c)
    // note: writeChat returns '# Chat' from mock so it gets written
    expect(result.filesGenerated).toContain('chat.md');
    // notes.md (has pass3d, even without synthesisResult)
    expect(result.filesGenerated).toContain('notes.md');
  });

  it('passes uncertainCodeFiles to writeCodeFiles as a Set', async () => {
    const pipelineResult: PipelineResult = {
      ...makeFullPipelineResult(),
      uncertainCodeFiles: ['utils.py', 'config.ts'],
    };

    const params = makeParams({ pipelineResult });
    await generateOutput(params);

    const callArgs = mockWriteCodeFiles.mock.calls[0][0];
    expect(callArgs.uncertainFiles).toBeInstanceOf(Set);
    expect(callArgs.uncertainFiles!.has('utils.py')).toBe(true);
    expect(callArgs.uncertainFiles!.has('config.ts')).toBe(true);
    expect(callArgs.uncertainFiles!.size).toBe(2);
  });

  it('passes empty Set when uncertainCodeFiles is undefined', async () => {
    const pipelineResult = makeFullPipelineResult();

    const params = makeParams({ pipelineResult });
    await generateOutput(params);

    const callArgs = mockWriteCodeFiles.mock.calls[0][0];
    expect(callArgs.uncertainFiles).toBeInstanceOf(Set);
    expect(callArgs.uncertainFiles!.size).toBe(0);
  });

  it('threads speakerMapping to writeTranscript', async () => {
    const { writeTranscript } = await import('./transcript.js');
    const mapping = { SPEAKER_00: 'Alice' };
    const params = makeParams({ speakerMapping: mapping });
    await generateOutput(params);
    const callArgs = (writeTranscript as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.speakerMapping).toMatchObject(mapping);
  });
});

// ---------------------------------------------------------------------------
// reRenderWithSpeakerMapping tests
// ---------------------------------------------------------------------------

describe('reRenderWithSpeakerMapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-renders transcript.md with speaker mapping', async () => {
    const { writeTranscript } = await import('./transcript.js');
    const mapping = { SPEAKER_00: 'Alice' };

    await reRenderWithSpeakerMapping({ outputDir: '/tmp/output/test-video', speakerMapping: mapping });

    const calls = (writeTranscript as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0].speakerMapping).toMatchObject(mapping);
  });

  it('does not modify raw/ files', async () => {
    const { writeFile } = await import('fs/promises');
    const mapping = { SPEAKER_00: 'Alice' };

    await reRenderWithSpeakerMapping({ outputDir: '/tmp/output/test-video', speakerMapping: mapping });

    const writeCalls = (writeFile as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string]>;
    const writtenPaths = writeCalls.map((c) => c[0]);
    expect(writtenPaths.every((p) => !p.includes('/raw/'))).toBe(true);
  });

  it('returns errors array and continues on write failure', async () => {
    const { writeFile } = await import('fs/promises');
    (writeFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));

    const mapping = { SPEAKER_00: 'Alice' };
    const result = await reRenderWithSpeakerMapping({ outputDir: '/tmp/output/test-video', speakerMapping: mapping });

    expect(result.errors.length).toBeGreaterThan(0);
    // Should still have re-rendered other files
  });

  it('returns outputDir unchanged', async () => {
    const mapping = { SPEAKER_00: 'Alice' };
    const result = await reRenderWithSpeakerMapping({ outputDir: '/tmp/output/test-video', speakerMapping: mapping });
    expect(result.outputDir).toBe('/tmp/output/test-video');
  });
});
