import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineResult, SpeakerMapping } from '../types/index.js';

// ---- hoisted mocks ----
const { mockText, mockSelect, mockIsCancel, mockCancel, mockLog } = vi.hoisted(() => ({
  mockText: vi.fn(),
  mockSelect: vi.fn(),
  mockIsCancel: vi.fn(),
  mockCancel: vi.fn(),
  mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@clack/prompts', () => ({
  text: mockText,
  select: mockSelect,
  isCancel: mockIsCancel,
  cancel: mockCancel,
  log: mockLog,
}));

import { buildSpeakerContext, promptSpeakerNames } from './speaker-naming.js';

// ---- helpers ----

function makePass1Result(speakerIds: string[], transcriptCounts?: Record<string, number>) {
  const speaker_summary = speakerIds.map((id) => ({
    speaker_id: id,
    description: `Description for ${id}`,
  }));
  const transcript_entries = speakerIds.flatMap((id) => {
    const count = transcriptCounts?.[id] ?? 3;
    return Array.from({ length: count }, (_, i) => ({
      timestamp: `00:0${i}:00`,
      speaker: id,
      text: `text ${i}`,
      tone: 'neutral',
    }));
  });
  return { segment_index: 0, time_range: '0-60', speaker_summary, transcript_entries };
}

function makePipelineResult(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
    segments: [],
    passesRun: [],
    errors: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  // Default: isCancel returns false (not cancelled)
  mockIsCancel.mockReturnValue(false);
});

// ---- buildSpeakerContext ----

describe('buildSpeakerContext', () => {
  it('returns empty array when no segments', () => {
    const result = buildSpeakerContext(makePipelineResult());
    expect(result).toEqual([]);
  });

  it('returns empty array when segments have no pass1', () => {
    const result = buildSpeakerContext(
      makePipelineResult({
        segments: [{ index: 0, pass1: null, pass2: null }],
      }),
    );
    expect(result).toEqual([]);
  });

  it('returns one speaker context for a single speaker', () => {
    const result = buildSpeakerContext(
      makePipelineResult({
        segments: [{ index: 0, pass1: makePass1Result(['SPEAKER_00']), pass2: null }],
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('SPEAKER_00');
  });

  it('deduplicates speakers across multiple segments', () => {
    const result = buildSpeakerContext(
      makePipelineResult({
        segments: [
          { index: 0, pass1: makePass1Result(['SPEAKER_00', 'SPEAKER_01']), pass2: null },
          { index: 1, pass1: makePass1Result(['SPEAKER_00', 'SPEAKER_01']), pass2: null },
        ],
      }),
    );
    expect(result).toHaveLength(2);
    const labels = result.map((s) => s.label);
    expect(labels).toContain('SPEAKER_00');
    expect(labels).toContain('SPEAKER_01');
  });

  it('sorts speakers by speaking time descending', () => {
    const result = buildSpeakerContext(
      makePipelineResult({
        segments: [
          {
            index: 0,
            pass1: makePass1Result(['SPEAKER_00', 'SPEAKER_01'], { SPEAKER_00: 2, SPEAKER_01: 8 }),
            pass2: null,
          },
        ],
      }),
    );
    // SPEAKER_01 has more entries → comes first
    expect(result[0].label).toBe('SPEAKER_01');
    expect(result[1].label).toBe('SPEAKER_00');
  });

  it('uses participant role as description when participant matches SPEAKER_XX label', () => {
    const result = buildSpeakerContext(
      makePipelineResult({
        segments: [{ index: 0, pass1: makePass1Result(['SPEAKER_00']), pass2: null }],
        peopleExtraction: {
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
        },
      }),
    );
    expect(result[0].description).toBe('Host');
  });

  it('prefers participant contributions over role', () => {
    const result = buildSpeakerContext(
      makePipelineResult({
        segments: [{ index: 0, pass1: makePass1Result(['SPEAKER_00']), pass2: null }],
        peopleExtraction: {
          participants: [
            {
              name: 'SPEAKER_00',
              role: 'Host',
              organization: '',
              speaking_segments: [],
              contact_info: [],
              contributions: ['Presented the main topic'],
            },
          ],
          relationships: [],
        },
      }),
    );
    expect(result[0].description).toBe('Presented the main topic');
  });

  it('falls back to speaker_summary description when no participant match', () => {
    const result = buildSpeakerContext(
      makePipelineResult({
        segments: [{ index: 0, pass1: makePass1Result(['SPEAKER_00']), pass2: null }],
        peopleExtraction: {
          participants: [
            {
              name: 'Alice',
              role: 'Host',
              organization: '',
              speaking_segments: [],
              contact_info: [],
              contributions: [],
            },
          ],
          relationships: [],
        },
      }),
    );
    expect(result[0].description).toBe('Description for SPEAKER_00');
  });

  it('includes speakingSeconds based on transcript entry count', () => {
    const result = buildSpeakerContext(
      makePipelineResult({
        segments: [
          {
            index: 0,
            pass1: makePass1Result(['SPEAKER_00'], { SPEAKER_00: 5 }),
            pass2: null,
          },
        ],
      }),
    );
    expect(result[0].speakingSeconds).toBe(5);
  });
});

// ---- promptSpeakerNames ----

describe('promptSpeakerNames', () => {
  it('returns null when no speakers detected (empty segments)', async () => {
    const result = await promptSpeakerNames(makePipelineResult());
    expect(result).toBeNull();
    expect(mockText).not.toHaveBeenCalled();
  });

  it('returns null when only 1 speaker detected', async () => {
    const result = await promptSpeakerNames(
      makePipelineResult({
        segments: [{ index: 0, pass1: makePass1Result(['SPEAKER_00']), pass2: null }],
      }),
    );
    expect(result).toBeNull();
    expect(mockText).not.toHaveBeenCalled();
  });

  it('prompts for each speaker when 3 speakers detected', async () => {
    mockText
      .mockResolvedValueOnce('Alice')
      .mockResolvedValueOnce('Bob')
      .mockResolvedValueOnce('Carol');

    const result = await promptSpeakerNames(
      makePipelineResult({
        segments: [
          {
            index: 0,
            pass1: makePass1Result(['SPEAKER_00', 'SPEAKER_01', 'SPEAKER_02']),
            pass2: null,
          },
        ],
      }),
    );

    expect(mockText).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      SPEAKER_00: 'Alice',
      SPEAKER_01: 'Bob',
      SPEAKER_02: 'Carol',
    });
  });

  it('skips speakers where user presses Enter (empty string)', async () => {
    mockText
      .mockResolvedValueOnce('Alice')
      .mockResolvedValueOnce('') // skip SPEAKER_01
      .mockResolvedValueOnce('Carol');

    const result = await promptSpeakerNames(
      makePipelineResult({
        segments: [
          {
            index: 0,
            pass1: makePass1Result(['SPEAKER_00', 'SPEAKER_01', 'SPEAKER_02']),
            pass2: null,
          },
        ],
      }),
    );

    expect(result).toEqual({
      SPEAKER_00: 'Alice',
      SPEAKER_02: 'Carol',
    });
    expect(result).not.toHaveProperty('SPEAKER_01');
  });

  it('returns empty object when user skips all speakers', async () => {
    mockText.mockResolvedValue('');

    const result = await promptSpeakerNames(
      makePipelineResult({
        segments: [
          {
            index: 0,
            pass1: makePass1Result(['SPEAKER_00', 'SPEAKER_01']),
            pass2: null,
          },
        ],
      }),
    );

    expect(result).toEqual({});
  });

  it('returns null when user cancels during speaker naming', async () => {
    const cancelSymbol = Symbol('cancel');
    mockIsCancel.mockImplementation((v) => v === cancelSymbol);
    mockText.mockResolvedValueOnce(cancelSymbol);

    const result = await promptSpeakerNames(
      makePipelineResult({
        segments: [
          {
            index: 0,
            pass1: makePass1Result(['SPEAKER_00', 'SPEAKER_01']),
            pass2: null,
          },
        ],
      }),
    );

    expect(result).toBeNull();
    expect(mockCancel).toHaveBeenCalledWith('Speaker naming cancelled.');
  });

  it('prompts top 5 for 8 speakers, then asks about remaining 3', async () => {
    // Top 5 speakers answered with names
    mockText
      .mockResolvedValueOnce('Alice')
      .mockResolvedValueOnce('Bob')
      .mockResolvedValueOnce('Carol')
      .mockResolvedValueOnce('Dave')
      .mockResolvedValueOnce('Eve');

    // User declines to name remaining
    mockSelect.mockResolvedValueOnce('no');

    const speakers = Array.from({ length: 8 }, (_, i) => `SPEAKER_0${i}`);
    const result = await promptSpeakerNames(
      makePipelineResult({
        segments: [
          {
            index: 0,
            pass1: makePass1Result(speakers),
            pass2: null,
          },
        ],
      }),
    );

    expect(mockText).toHaveBeenCalledTimes(5);
    expect(mockSelect).toHaveBeenCalledTimes(1);
    // Mapping contains only top 5
    expect(Object.keys(result!)).toHaveLength(5);
  });

  it('names all speakers when user selects yes for remaining', async () => {
    mockText
      .mockResolvedValueOnce('Alice')
      .mockResolvedValueOnce('Bob')
      .mockResolvedValueOnce('Carol')
      .mockResolvedValueOnce('Dave')
      .mockResolvedValueOnce('Eve')
      // remaining 3
      .mockResolvedValueOnce('Frank')
      .mockResolvedValueOnce('Grace')
      .mockResolvedValueOnce('Hank');

    mockSelect.mockResolvedValueOnce('yes');

    const speakers = Array.from({ length: 8 }, (_, i) => `SPEAKER_0${i}`);
    const result = await promptSpeakerNames(
      makePipelineResult({
        segments: [
          {
            index: 0,
            pass1: makePass1Result(speakers),
            pass2: null,
          },
        ],
      }),
    );

    expect(mockText).toHaveBeenCalledTimes(8);
    expect(Object.keys(result!)).toHaveLength(8);
  });

  it('returns null when user cancels the remaining-speakers select', async () => {
    mockText
      .mockResolvedValueOnce('Alice')
      .mockResolvedValueOnce('Bob')
      .mockResolvedValueOnce('Carol')
      .mockResolvedValueOnce('Dave')
      .mockResolvedValueOnce('Eve');

    const cancelSymbol = Symbol('cancel');
    mockIsCancel.mockImplementation((v) => v === cancelSymbol);
    mockSelect.mockResolvedValueOnce(cancelSymbol);

    const speakers = Array.from({ length: 8 }, (_, i) => `SPEAKER_0${i}`);
    const result = await promptSpeakerNames(
      makePipelineResult({
        segments: [
          {
            index: 0,
            pass1: makePass1Result(speakers),
            pass2: null,
          },
        ],
      }),
    );

    expect(result).toBeNull();
    expect(mockCancel).toHaveBeenCalledWith('Speaker naming cancelled.');
  });

  it('returns null silently when prompts throw (non-TTY)', async () => {
    mockText.mockRejectedValueOnce(new Error('not a tty'));

    const result = await promptSpeakerNames(
      makePipelineResult({
        segments: [
          {
            index: 0,
            pass1: makePass1Result(['SPEAKER_00', 'SPEAKER_01']),
            pass2: null,
          },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it('does not show remaining-speakers prompt when exactly 5 speakers detected', async () => {
    mockText.mockResolvedValue('Name');

    const speakers = Array.from({ length: 5 }, (_, i) => `SPEAKER_0${i}`);
    const result = await promptSpeakerNames(
      makePipelineResult({
        segments: [
          {
            index: 0,
            pass1: makePass1Result(speakers),
            pass2: null,
          },
        ],
      }),
    );

    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockText).toHaveBeenCalledTimes(5);
    expect(result).not.toBeNull();
  });
});
