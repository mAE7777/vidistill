import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- hoisted mocks ----
const { mockText, mockIsCancel, mockCancel, mockLog, mockReadFile, mockReRender } = vi.hoisted(
  () => ({
    mockText: vi.fn(),
    mockIsCancel: vi.fn(),
    mockCancel: vi.fn(),
    mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    mockReadFile: vi.fn(),
    mockReRender: vi.fn(),
  }),
);

vi.mock('@clack/prompts', () => ({
  text: mockText,
  isCancel: mockIsCancel,
  cancel: mockCancel,
  log: mockLog,
}));

vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
}));

vi.mock('../output/generator.js', () => ({
  reRenderWithSpeakerMapping: mockReRender,
}));

import { run } from './rename-speakers.js';

// ---- helpers ----

function makeMetadata(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    videoTitle: 'Test Video',
    source: 'test.mp4',
    duration: 600,
    type: 'meeting',
    model: 'gemini-pro',
    passesRun: ['pass1'],
    segmentCount: 1,
    processingTimeMs: 5000,
    filesGenerated: ['transcript.md', 'metadata.json'],
    errors: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

function makePeopleExtraction(): string {
  return JSON.stringify({
    participants: [
      {
        name: 'SPEAKER_00',
        role: 'Host',
        organization: '',
        speaking_segments: [],
        contact_info: [],
        contributions: [],
      },
    ],
    relationships: [],
  });
}

function makePass1(
  speakerIds: string[],
  counts: Record<string, number> = {},
): string {
  const speaker_summary = speakerIds.map((id) => ({
    speaker_id: id,
    description: `Desc for ${id}`,
  }));
  const transcript_entries = speakerIds.flatMap((id) => {
    const n = counts[id] ?? 3;
    return Array.from({ length: n }, (_, i) => ({
      timestamp: `00:0${i}:00`,
      speaker: id,
      text: `text ${i}`,
      tone: 'neutral',
    }));
  });
  return JSON.stringify({ segment_index: 0, time_range: '0-60', speaker_summary, transcript_entries });
}

/** Set up readFile mock to respond based on path substring */
function setupReadFile(files: Record<string, string | null>): void {
  mockReadFile.mockImplementation((filePath: string) => {
    for (const [key, value] of Object.entries(files)) {
      if (filePath.includes(key)) {
        if (value == null) return Promise.reject(new Error('ENOENT'));
        return Promise.resolve(value);
      }
    }
    return Promise.reject(new Error(`ENOENT: no such file: ${filePath}`));
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockIsCancel.mockReturnValue(false);
  mockReRender.mockResolvedValue({ outputDir: '/out/dir', filesGenerated: ['transcript.md', 'metadata.json'], errors: [] });
});

// ---- tests ----

describe('rename-speakers run()', () => {
  it('shows usage error when no directory argument provided', async () => {
    await run([]);
    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('shows usage error when empty string argument provided', async () => {
    await run(['']);
    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('errors when metadata.json does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    await run(['/some/dir']);

    expect(mockLog.error).toHaveBeenCalledWith('Not a vidistill output directory');
    expect(mockText).not.toHaveBeenCalled();
  });

  it('errors when metadata.json contains invalid JSON', async () => {
    mockReadFile.mockResolvedValueOnce('not json');

    await run(['/some/dir']);

    expect(mockLog.error).toHaveBeenCalledWith('Not a vidistill output directory');
  });

  it('informs user when no people extraction data exists', async () => {
    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass3b-people.json': null,
    });

    await run(['/some/dir']);

    expect(mockLog.info).toHaveBeenCalledWith('No speakers detected in this video');
    expect(mockText).not.toHaveBeenCalled();
  });

  it('informs user when pass1 files yield no speakers', async () => {
    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': null, // no segments
    });

    await run(['/some/dir']);

    expect(mockLog.info).toHaveBeenCalledWith('No speakers detected in this video');
    expect(mockText).not.toHaveBeenCalled();
  });

  it('prompts for all 2 speakers when 2 are detected', async () => {
    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(['SPEAKER_00', 'SPEAKER_01']),
      'pass1-seg1.json': null,
    });

    mockText.mockResolvedValueOnce('Alice').mockResolvedValueOnce('Bob');

    await run(['/some/dir']);

    expect(mockText).toHaveBeenCalledTimes(2);
    expect(mockReRender).toHaveBeenCalledWith({
      outputDir: '/some/dir',
      speakerMapping: { SPEAKER_00: 'Alice', SPEAKER_01: 'Bob' },
    });
  });

  it('prompts for ALL 8 speakers without a cap', async () => {
    const speakers = Array.from({ length: 8 }, (_, i) => `SPEAKER_0${i}`);
    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(speakers),
      'pass1-seg1.json': null,
    });

    mockText.mockResolvedValue('Name');

    await run(['/some/dir']);

    expect(mockText).toHaveBeenCalledTimes(8);
  });

  it('uses existing mapped names as defaultValue', async () => {
    setupReadFile({
      'metadata.json': makeMetadata({ speakerMapping: { SPEAKER_00: 'Alice' } }),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(['SPEAKER_00', 'SPEAKER_01']),
      'pass1-seg1.json': null,
    });

    mockText.mockResolvedValue('Name');

    await run(['/some/dir']);

    // First call should have defaultValue of 'Alice' (the existing mapping)
    expect(mockText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ defaultValue: 'Alice' }),
    );
    // Second call should have defaultValue of 'SPEAKER_01' (unmapped, falls back to label)
    expect(mockText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ defaultValue: 'SPEAKER_01' }),
    );
  });

  it('skips adding to mapping when user returns empty string', async () => {
    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(['SPEAKER_00', 'SPEAKER_01']),
      'pass1-seg1.json': null,
    });

    mockText.mockResolvedValueOnce('Alice').mockResolvedValueOnce('');

    await run(['/some/dir']);

    expect(mockReRender).toHaveBeenCalledWith({
      outputDir: '/some/dir',
      speakerMapping: { SPEAKER_00: 'Alice' },
    });
  });

  it('removes mapping when user types the raw label back (no-op)', async () => {
    setupReadFile({
      'metadata.json': makeMetadata({ speakerMapping: { SPEAKER_00: 'Alice' } }),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(['SPEAKER_00']),
      'pass1-seg1.json': null,
    });

    // User types the raw label — treated as clearing the mapping
    mockText.mockResolvedValueOnce('SPEAKER_00');

    await run(['/some/dir']);

    expect(mockReRender).toHaveBeenCalledWith({
      outputDir: '/some/dir',
      speakerMapping: {},
    });
  });

  it('cancels when user cancels a text prompt', async () => {
    const cancelSymbol = Symbol('cancel');
    mockIsCancel.mockImplementation((v) => v === cancelSymbol);

    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(['SPEAKER_00', 'SPEAKER_01']),
      'pass1-seg1.json': null,
    });

    mockText.mockResolvedValueOnce(cancelSymbol);

    await run(['/some/dir']);

    expect(mockCancel).toHaveBeenCalledWith('Speaker naming cancelled.');
    expect(mockReRender).not.toHaveBeenCalled();
  });

  it('collects speakers across multiple segment files', async () => {
    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(['SPEAKER_00']),
      'pass1-seg1.json': makePass1(['SPEAKER_01']),
      'pass1-seg2.json': null,
    });

    mockText.mockResolvedValue('Name');

    await run(['/some/dir']);

    expect(mockText).toHaveBeenCalledTimes(2);
  });

  it('deduplicates speakers appearing in multiple segments', async () => {
    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(['SPEAKER_00', 'SPEAKER_01']),
      'pass1-seg1.json': makePass1(['SPEAKER_00', 'SPEAKER_01']),
      'pass1-seg2.json': null,
    });

    mockText.mockResolvedValue('Name');

    await run(['/some/dir']);

    // Even though SPEAKER_00 and SPEAKER_01 appear in 2 segments, only 2 prompts shown
    expect(mockText).toHaveBeenCalledTimes(2);
  });

  it('logs errors when re-render produces errors', async () => {
    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(['SPEAKER_00']),
      'pass1-seg1.json': null,
    });

    mockText.mockResolvedValueOnce('Alice');
    mockReRender.mockResolvedValue({
      outputDir: '/some/dir',
      filesGenerated: [],
      errors: ['transcript.md: write error'],
    });

    await run(['/some/dir']);

    expect(mockLog.error).toHaveBeenCalledWith('transcript.md: write error');
  });

  it('logs completion with file count', async () => {
    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(['SPEAKER_00']),
      'pass1-seg1.json': null,
    });

    mockText.mockResolvedValueOnce('Alice');
    mockReRender.mockResolvedValue({
      outputDir: '/some/dir',
      filesGenerated: ['transcript.md', 'metadata.json'],
      errors: [],
    });

    await run(['/some/dir']);

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('2 files updated'));
  });

  it('sorts speakers by entry count descending', async () => {
    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(
        ['SPEAKER_00', 'SPEAKER_01'],
        { SPEAKER_00: 2, SPEAKER_01: 8 },
      ),
      'pass1-seg1.json': null,
    });

    const calledLabels: string[] = [];
    mockText.mockImplementation((opts: { message: string }) => {
      const match = opts.message.match(/SPEAKER_\d+/);
      if (match) calledLabels.push(match[0]);
      return Promise.resolve('Name');
    });

    await run(['/some/dir']);

    // SPEAKER_01 has more entries → prompted first
    expect(calledLabels[0]).toBe('SPEAKER_01');
    expect(calledLabels[1]).toBe('SPEAKER_00');
  });
});
