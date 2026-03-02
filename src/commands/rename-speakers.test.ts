import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- hoisted mocks ----
const { mockText, mockConfirm, mockIsCancel, mockCancel, mockLog, mockReadFile, mockReRender } = vi.hoisted(
  () => ({
    mockText: vi.fn(),
    mockConfirm: vi.fn(),
    mockIsCancel: vi.fn(),
    mockCancel: vi.fn(),
    mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    mockReadFile: vi.fn(),
    mockReRender: vi.fn(),
  }),
);

vi.mock('@clack/prompts', () => ({
  text: mockText,
  confirm: mockConfirm,
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
  descriptions: Record<string, string> = {},
): string {
  const speaker_summary = speakerIds.map((id) => ({
    speaker_id: id,
    description: descriptions[id] ?? `Desc for ${id}`,
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
  mockConfirm.mockResolvedValue(true);
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
    expect(mockReRender).toHaveBeenCalledWith(
      expect.objectContaining({
        outputDir: '/some/dir',
        speakerMapping: { SPEAKER_00: 'Alice', SPEAKER_01: 'Bob' },
      }),
    );
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

  it('uses existing mapped name in prompt message when mapping exists', async () => {
    setupReadFile({
      'metadata.json': makeMetadata({ speakerMapping: { SPEAKER_00: 'Eugene' } }),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(['SPEAKER_00'], { SPEAKER_00: 45 }),
      'pass1-seg1.json': null,
    });

    mockText.mockResolvedValue('Name');

    await run(['/some/dir']);

    expect(mockText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: 'Name for Eugene [SPEAKER_00, 45 entries]:',
      }),
    );
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

  it('shows description in prompt message when no existing mapping', async () => {
    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(
        ['SPEAKER_00', 'SPEAKER_01'],
        { SPEAKER_00: 3, SPEAKER_01: 3 },
        { SPEAKER_00: 'Professor Eugene Callahan, the main speaker', SPEAKER_01: '' },
      ),
      'pass1-seg1.json': null,
    });

    mockText.mockResolvedValue('Name');

    await run(['/some/dir']);

    expect(mockText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: 'Name for SPEAKER_00 — Professor Eugene Callahan, the main speaker [3 entries]:',
      }),
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

    expect(mockReRender).toHaveBeenCalledWith(
      expect.objectContaining({
        outputDir: '/some/dir',
        speakerMapping: { SPEAKER_00: 'Alice' },
      }),
    );
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

    expect(mockReRender).toHaveBeenCalledWith(
      expect.objectContaining({
        outputDir: '/some/dir',
        speakerMapping: {},
      }),
    );
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

  // ---- merge detection tests in rename-speakers context ----

  it('prompts merge confirmation when two speakers are assigned same name', async () => {
    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(['SPEAKER_02', 'SPEAKER_05']),
      'pass1-seg1.json': null,
    });

    mockText.mockResolvedValueOnce('Kristian').mockResolvedValueOnce('Kristian');
    mockConfirm.mockResolvedValue(true);

    await run(['/some/dir']);

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("You assigned 'Kristian' to both SPEAKER_02 and SPEAKER_05"),
      }),
    );
    expect(mockReRender).toHaveBeenCalledWith(
      expect.objectContaining({
        speakerMapping: { SPEAKER_02: 'Kristian', SPEAKER_05: 'Kristian' },
      }),
    );
  });

  it('stores declinedMerges when user declines merge', async () => {
    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(['SPEAKER_02', 'SPEAKER_05']),
      'pass1-seg1.json': null,
    });

    mockText.mockResolvedValueOnce('Kristian').mockResolvedValueOnce('Kristian');
    mockConfirm.mockResolvedValue(false);

    await run(['/some/dir']);

    expect(mockReRender).toHaveBeenCalledWith(
      expect.objectContaining({
        speakerMapping: { SPEAKER_02: 'Kristian', SPEAKER_05: 'Kristian' },
        declinedMerges: [['SPEAKER_02', 'SPEAKER_05']],
      }),
    );
  });

  it('cancels entire operation when user cancels during merge prompt', async () => {
    const cancelSymbol = Symbol('cancel');
    mockIsCancel.mockImplementation((v) => v === cancelSymbol);

    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(['SPEAKER_02', 'SPEAKER_05']),
      'pass1-seg1.json': null,
    });

    mockText.mockResolvedValueOnce('Kristian').mockResolvedValueOnce('Kristian');
    mockConfirm.mockResolvedValue(cancelSymbol);

    await run(['/some/dir']);

    expect(mockCancel).toHaveBeenCalledWith('Speaker naming cancelled.');
    expect(mockReRender).not.toHaveBeenCalled();
  });

  it('prompts each pair individually for 3 speakers with same name', async () => {
    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(['SPEAKER_01', 'SPEAKER_03', 'SPEAKER_05']),
      'pass1-seg1.json': null,
    });

    mockText.mockResolvedValue('Kristian');
    mockConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await run(['/some/dir']);

    // 2 prompts for 3 speakers with same name
    expect(mockConfirm).toHaveBeenCalledTimes(2);
  });

  it('shows merged speaker group as single prompt entry when speakers already share a name', async () => {
    setupReadFile({
      'metadata.json': makeMetadata({ speakerMapping: { SPEAKER_02: 'Kristian', SPEAKER_05: 'Kristian' } }),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(['SPEAKER_02', 'SPEAKER_05'], { SPEAKER_02: 3, SPEAKER_05: 3 }),
      'pass1-seg1.json': null,
    });

    mockText.mockResolvedValue('Kristian');

    await run(['/some/dir']);

    // Only 1 prompt shown (the merged group), not 2 separate prompts
    expect(mockText).toHaveBeenCalledTimes(1);
    expect(mockText).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Kristian [SPEAKER_02 + SPEAKER_05'),
      }),
    );
  });

  it('does not pass declinedMerges to reRender when list is empty', async () => {
    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass3b-people.json': makePeopleExtraction(),
      'pass1-seg0.json': makePass1(['SPEAKER_00', 'SPEAKER_01']),
      'pass1-seg1.json': null,
    });

    mockText.mockResolvedValueOnce('Alice').mockResolvedValueOnce('Bob');

    await run(['/some/dir']);

    // declinedMerges should be undefined when empty (not passed)
    expect(mockReRender).toHaveBeenCalledWith(
      expect.objectContaining({
        speakerMapping: { SPEAKER_00: 'Alice', SPEAKER_01: 'Bob' },
      }),
    );
    // declinedMerges should not be in the call (undefined is excluded)
    const callArg = mockReRender.mock.calls[0][0];
    expect(callArg.declinedMerges).toBeUndefined();
  });
});

// ---- --list flag tests ----

describe('rename-speakers --list flag', () => {
  it('displays numbered list of speakers with labels and entry counts', async () => {
    setupReadFile({
      'metadata.json': makeMetadata({
        speakerMapping: { SPEAKER_00: 'Eugene Callahan', SPEAKER_01: 'Alice' },
      }),
      'pass1-seg0.json': makePass1(
        ['SPEAKER_00', 'SPEAKER_01'],
        { SPEAKER_00: 45, SPEAKER_01: 10 },
      ),
      'pass1-seg1.json': null,
    });

    await run(['/some/dir', '--list']);

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('1. Eugene Callahan (SPEAKER_00, 45 entries)'),
    );
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('2. Alice (SPEAKER_01, 10 entries)'),
    );
    expect(mockText).not.toHaveBeenCalled();
    expect(mockReRender).not.toHaveBeenCalled();
  });

  it('displays "No speakers found." when no speakers exist', async () => {
    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass1-seg0.json': null,
    });

    await run(['/some/dir', '--list']);

    expect(mockLog.info).toHaveBeenCalledWith('No speakers found.');
  });

  it('errors when output dir is invalid', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    await run(['/bad/dir', '--list']);

    expect(mockLog.error).toHaveBeenCalledWith('Not a vidistill output directory');
  });

  it('shows unmapped speaker labels in list', async () => {
    setupReadFile({
      'metadata.json': makeMetadata(),
      'pass1-seg0.json': makePass1(['SPEAKER_00'], { SPEAKER_00: 7 }),
      'pass1-seg1.json': null,
    });

    await run(['/some/dir', '--list']);

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('1. SPEAKER_00 (SPEAKER_00, 7 entries)'),
    );
  });

  it('accepts outputDir before --list flag', async () => {
    setupReadFile({
      'metadata.json': makeMetadata({ speakerMapping: { SPEAKER_00: 'Alice' } }),
      'pass1-seg0.json': makePass1(['SPEAKER_00'], { SPEAKER_00: 5 }),
      'pass1-seg1.json': null,
    });

    await run(['--list', '/some/dir']);

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('Alice (SPEAKER_00, 5 entries)'),
    );
  });

  it('shows merged speakers as one entry with combined labels', async () => {
    setupReadFile({
      'metadata.json': makeMetadata({
        speakerMapping: { SPEAKER_02: 'Kristian', SPEAKER_05: 'Kristian' },
      }),
      'pass1-seg0.json': makePass1(
        ['SPEAKER_02', 'SPEAKER_05'],
        { SPEAKER_02: 10, SPEAKER_05: 8 },
      ),
      'pass1-seg1.json': null,
    });

    await run(['/some/dir', '--list']);

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining('Kristian (SPEAKER_02, SPEAKER_05, 18 entries)'),
    );
  });
});

// ---- --rename flag tests ----

describe('rename-speakers --rename flag', () => {
  it('renames a speaker by mapped name and re-renders', async () => {
    setupReadFile({
      'metadata.json': makeMetadata({
        speakerMapping: { SPEAKER_00: 'Steven Kang' },
      }),
      'pass1-seg0.json': makePass1(['SPEAKER_00'], { SPEAKER_00: 5 }),
      'pass1-seg1.json': null,
    });

    await run(['/some/dir', '--rename', 'Steven Kang', 'Steven K.']);

    expect(mockReRender).toHaveBeenCalledWith(
      expect.objectContaining({
        outputDir: '/some/dir',
        speakerMapping: { SPEAKER_00: 'Steven K.' },
      }),
    );
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('updated'));
    expect(mockText).not.toHaveBeenCalled();
  });

  it('errors with list when name not found', async () => {
    setupReadFile({
      'metadata.json': makeMetadata({
        speakerMapping: { SPEAKER_00: 'Alice', SPEAKER_01: 'Bob' },
      }),
      'pass1-seg0.json': makePass1(['SPEAKER_00', 'SPEAKER_01'], { SPEAKER_00: 5, SPEAKER_01: 3 }),
      'pass1-seg1.json': null,
    });

    await run(['/some/dir', '--rename', 'Unknown', 'Alice']);

    expect(mockLog.error).toHaveBeenCalledWith(
      expect.stringContaining('No speaker named "Unknown" found'),
    );
    expect(mockLog.error).toHaveBeenCalledWith(
      expect.stringContaining('Alice'),
    );
    expect(mockReRender).not.toHaveBeenCalled();
  });

  it('errors with ambiguity when multiple speakers share the same name', async () => {
    setupReadFile({
      'metadata.json': makeMetadata({
        speakerMapping: { SPEAKER_01: 'John', SPEAKER_03: 'John' },
      }),
      'pass1-seg0.json': makePass1(['SPEAKER_01', 'SPEAKER_03'], { SPEAKER_01: 5, SPEAKER_03: 3 }),
      'pass1-seg1.json': null,
    });

    await run(['/some/dir', '--rename', 'John', 'Jonathan']);

    expect(mockLog.error).toHaveBeenCalledWith(
      expect.stringContaining('Multiple speakers named "John"'),
    );
    expect(mockLog.error).toHaveBeenCalledWith(
      expect.stringContaining('SPEAKER_01'),
    );
    expect(mockLog.error).toHaveBeenCalledWith(
      expect.stringContaining('SPEAKER_03'),
    );
    expect(mockLog.error).toHaveBeenCalledWith(
      expect.stringContaining('Use SPEAKER_XX label'),
    );
    expect(mockReRender).not.toHaveBeenCalled();
  });

  it('renames by SPEAKER_XX label directly', async () => {
    setupReadFile({
      'metadata.json': makeMetadata({
        speakerMapping: { SPEAKER_00: 'Alice' },
      }),
      'pass1-seg0.json': makePass1(['SPEAKER_00', 'SPEAKER_01'], { SPEAKER_00: 5, SPEAKER_01: 3 }),
      'pass1-seg1.json': null,
    });

    await run(['/some/dir', '--rename', 'SPEAKER_01', 'Bob']);

    expect(mockReRender).toHaveBeenCalledWith(
      expect.objectContaining({
        speakerMapping: expect.objectContaining({ SPEAKER_01: 'Bob' }),
      }),
    );
  });

  it('errors when metadata.json is missing', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    await run(['/bad/dir', '--rename', 'Alice', 'Bob']);

    expect(mockLog.error).toHaveBeenCalledWith('Not a vidistill output directory');
    expect(mockReRender).not.toHaveBeenCalled();
  });
});

// ---- --merge flag tests ----

describe('rename-speakers --merge flag', () => {
  it('merges source speaker into target speaker and re-renders', async () => {
    setupReadFile({
      'metadata.json': makeMetadata({
        speakerMapping: { SPEAKER_01: 'K Iphone', SPEAKER_02: 'Kristian' },
      }),
      'pass1-seg0.json': makePass1(['SPEAKER_01', 'SPEAKER_02'], { SPEAKER_01: 3, SPEAKER_02: 8 }),
      'pass1-seg1.json': null,
    });

    await run(['/some/dir', '--merge', 'K Iphone', 'Kristian']);

    expect(mockReRender).toHaveBeenCalledWith(
      expect.objectContaining({
        outputDir: '/some/dir',
        speakerMapping: { SPEAKER_01: 'Kristian', SPEAKER_02: 'Kristian' },
      }),
    );
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('updated'));
    expect(mockText).not.toHaveBeenCalled();
  });

  it('errors when source name does not exist', async () => {
    setupReadFile({
      'metadata.json': makeMetadata({
        speakerMapping: { SPEAKER_00: 'Kristian' },
      }),
      'pass1-seg0.json': makePass1(['SPEAKER_00'], { SPEAKER_00: 5 }),
      'pass1-seg1.json': null,
    });

    await run(['/some/dir', '--merge', 'K Iphone', 'Kristian']);

    expect(mockLog.error).toHaveBeenCalledWith(
      expect.stringContaining('No speaker named "K Iphone" found'),
    );
    expect(mockReRender).not.toHaveBeenCalled();
  });

  it('errors when target name does not exist', async () => {
    setupReadFile({
      'metadata.json': makeMetadata({
        speakerMapping: { SPEAKER_01: 'K Iphone' },
      }),
      'pass1-seg0.json': makePass1(['SPEAKER_01'], { SPEAKER_01: 3 }),
      'pass1-seg1.json': null,
    });

    await run(['/some/dir', '--merge', 'K Iphone', 'Nobody']);

    expect(mockLog.error).toHaveBeenCalledWith(
      expect.stringContaining('No speaker named "Nobody" found'),
    );
    expect(mockReRender).not.toHaveBeenCalled();
  });

  it('errors when metadata.json is missing', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    await run(['/bad/dir', '--merge', 'Alice', 'Bob']);

    expect(mockLog.error).toHaveBeenCalledWith('Not a vidistill output directory');
    expect(mockReRender).not.toHaveBeenCalled();
  });

  it('merges multiple source keys into target when source has multiple labels', async () => {
    setupReadFile({
      'metadata.json': makeMetadata({
        speakerMapping: {
          SPEAKER_01: 'K Iphone',
          SPEAKER_03: 'K Iphone',
          SPEAKER_02: 'Kristian',
        },
      }),
      'pass1-seg0.json': makePass1(
        ['SPEAKER_01', 'SPEAKER_02', 'SPEAKER_03'],
        { SPEAKER_01: 3, SPEAKER_02: 8, SPEAKER_03: 2 },
      ),
      'pass1-seg1.json': null,
    });

    await run(['/some/dir', '--merge', 'K Iphone', 'Kristian']);

    expect(mockReRender).toHaveBeenCalledWith(
      expect.objectContaining({
        speakerMapping: {
          SPEAKER_01: 'Kristian',
          SPEAKER_02: 'Kristian',
          SPEAKER_03: 'Kristian',
        },
      }),
    );
  });

  it('preserves declinedMerges from existing metadata when re-rendering', async () => {
    setupReadFile({
      'metadata.json': makeMetadata({
        speakerMapping: { SPEAKER_00: 'Alice', SPEAKER_01: 'Bob' },
        declinedMerges: [['SPEAKER_00', 'SPEAKER_01']],
      }),
      'pass1-seg0.json': makePass1(['SPEAKER_00', 'SPEAKER_01', 'SPEAKER_02'], { SPEAKER_00: 5, SPEAKER_01: 3, SPEAKER_02: 2 }),
      'pass1-seg1.json': null,
    });

    await run(['/some/dir', '--merge', 'SPEAKER_02', 'Alice']);

    expect(mockReRender).toHaveBeenCalledWith(
      expect.objectContaining({
        declinedMerges: [['SPEAKER_00', 'SPEAKER_01']],
      }),
    );
  });
});
