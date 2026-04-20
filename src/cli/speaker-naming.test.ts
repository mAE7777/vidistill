import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineResult, SpeakerMapping } from '../types/index.js';

// ---- hoisted mocks ----
const { mockText, mockConfirm, mockIsCancel, mockCancel, mockLog } = vi.hoisted(() => ({
  mockText: vi.fn(),
  mockConfirm: vi.fn(),
  mockIsCancel: vi.fn(),
  mockCancel: vi.fn(),
  mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@clack/prompts', () => ({
  text: mockText,
  confirm: mockConfirm,
  isCancel: mockIsCancel,
  cancel: mockCancel,
  log: mockLog,
}));

import { buildSpeakerContext, promptSpeakerNames, detectAndPromptMerges } from './speaker-naming.js';

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
    apiCallCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  // Default: isCancel returns false (not cancelled)
  mockIsCancel.mockReturnValue(false);
  // Default: confirm returns true (user accepts merge)
  mockConfirm.mockResolvedValue(true);
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
    expect(result?.mapping).toEqual({
      SPEAKER_00: 'Alice',
      SPEAKER_01: 'Bob',
      SPEAKER_02: 'Carol',
    });
    expect(result?.declinedMerges).toEqual([]);
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

    expect(result?.mapping).toEqual({
      SPEAKER_00: 'Alice',
      SPEAKER_02: 'Carol',
    });
    expect(result?.mapping).not.toHaveProperty('SPEAKER_01');
  });

  it('returns empty mapping when user skips all speakers', async () => {
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

    expect(result?.mapping).toEqual({});
    expect(result?.declinedMerges).toEqual([]);
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

  it('prompts for all 8 speakers sequentially with no split or confirmation gate', async () => {
    mockText.mockResolvedValue('Name');

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
    // All 8 got the same name "Name" — merge prompts shown for each pair
    // SPEAKER_00 is primary, others are secondary
    expect(mockConfirm).toHaveBeenCalledTimes(7);
    expect(result).not.toBeNull();
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

  it('prompt message includes description and entry count when description is present', async () => {
    mockText.mockResolvedValue('Alice');

    const pass1 = {
      segment_index: 0,
      time_range: '0-60',
      speaker_summary: [{ speaker_id: 'SPEAKER_00', description: 'Professor Eugene Callahan, the main speaker' }],
      transcript_entries: Array.from({ length: 45 }, (_, i) => ({
        timestamp: `00:0${i}:00`,
        speaker: 'SPEAKER_00',
        text: `text ${i}`,
        tone: 'neutral',
      })),
    };

    await promptSpeakerNames(
      makePipelineResult({
        segments: [
          { index: 0, pass1, pass2: null },
          { index: 1, pass1: makePass1Result(['SPEAKER_01']), pass2: null },
        ],
      }),
    );

    expect(mockText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: 'Name for SPEAKER_00 — Professor Eugene Callahan, the main speaker [45 entries]:',
      }),
    );
  });

  it('prompt message includes entry count without description when description is empty', async () => {
    mockText.mockResolvedValue('Alice');

    const pass1 = {
      segment_index: 0,
      time_range: '0-60',
      speaker_summary: [
        { speaker_id: 'SPEAKER_00', description: '' },
        { speaker_id: 'SPEAKER_01', description: '' },
      ],
      transcript_entries: [
        { timestamp: '00:00:00', speaker: 'SPEAKER_00', text: 'hi', tone: 'neutral' },
        { timestamp: '00:01:00', speaker: 'SPEAKER_01', text: 'hello', tone: 'neutral' },
      ],
    };

    await promptSpeakerNames(makePipelineResult({ segments: [{ index: 0, pass1, pass2: null }] }));

    expect(mockText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: expect.stringMatching(/^Name for SPEAKER_\d+ \[\d+ entries\]:$/),
      }),
    );
  });
});

// ---- detectAndPromptMerges ----

describe('detectAndPromptMerges', () => {
  it('returns mapping and empty declinedMerges when no duplicates', async () => {
    const mapping: SpeakerMapping = { SPEAKER_00: 'Alice', SPEAKER_01: 'Bob' };
    const result = await detectAndPromptMerges(mapping);
    expect(result).not.toBeNull();
    expect(result?.mapping).toEqual(mapping);
    expect(result?.declinedMerges).toEqual([]);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('prompts merge when two speakers share the same name', async () => {
    mockConfirm.mockResolvedValue(true);
    const mapping: SpeakerMapping = { SPEAKER_02: 'Kristian', SPEAKER_05: 'Kristian' };
    const result = await detectAndPromptMerges(mapping);
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("You assigned 'Kristian' to both SPEAKER_02 and SPEAKER_05"),
      }),
    );
    expect(result?.declinedMerges).toEqual([]);
    expect(result?.mapping).toEqual({ SPEAKER_02: 'Kristian', SPEAKER_05: 'Kristian' });
  });

  it('records declined merge pair when user declines', async () => {
    mockConfirm.mockResolvedValue(false);
    const mapping: SpeakerMapping = { SPEAKER_02: 'Kristian', SPEAKER_05: 'Kristian' };
    const result = await detectAndPromptMerges(mapping);
    expect(result?.declinedMerges).toEqual([['SPEAKER_02', 'SPEAKER_05']]);
    // Both still map to Kristian regardless
    expect(result?.mapping.SPEAKER_02).toBe('Kristian');
    expect(result?.mapping.SPEAKER_05).toBe('Kristian');
  });

  it('prompts each pair individually for 3 speakers with same name', async () => {
    mockConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const mapping: SpeakerMapping = {
      SPEAKER_01: 'Kristian',
      SPEAKER_03: 'Kristian',
      SPEAKER_05: 'Kristian',
    };
    const result = await detectAndPromptMerges(mapping);
    // Primary is SPEAKER_01 (lowest sort order)
    // Prompts: SPEAKER_03 into SPEAKER_01, SPEAKER_05 into SPEAKER_01
    expect(mockConfirm).toHaveBeenCalledTimes(2);
    // First accept, second decline
    expect(result?.declinedMerges).toEqual([['SPEAKER_01', 'SPEAKER_05']]);
  });

  it('returns null when user cancels during merge prompt', async () => {
    const cancelSymbol = Symbol('cancel');
    mockIsCancel.mockImplementation((v) => v === cancelSymbol);
    mockConfirm.mockResolvedValue(cancelSymbol);

    const mapping: SpeakerMapping = { SPEAKER_02: 'Kristian', SPEAKER_05: 'Kristian' };
    const result = await detectAndPromptMerges(mapping);
    expect(result).toBeNull();
    expect(mockCancel).toHaveBeenCalledWith('Speaker naming cancelled.');
  });

  it('handles empty mapping with no prompts', async () => {
    const result = await detectAndPromptMerges({});
    expect(result).not.toBeNull();
    expect(result?.mapping).toEqual({});
    expect(result?.declinedMerges).toEqual([]);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('merge prompt message matches expected format', async () => {
    mockConfirm.mockResolvedValue(true);
    const mapping: SpeakerMapping = { SPEAKER_02: 'Kristian', SPEAKER_05: 'Kristian' };
    await detectAndPromptMerges(mapping);
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "You assigned 'Kristian' to both SPEAKER_02 and SPEAKER_05. Merge SPEAKER_05 into SPEAKER_02 (Kristian)?",
      }),
    );
  });

  it('picks the first key (lowest sort order) as primary', async () => {
    mockConfirm.mockResolvedValue(true);
    // SPEAKER_05 comes before SPEAKER_10 in sort order (string comparison)
    const mapping: SpeakerMapping = { SPEAKER_10: 'Alice', SPEAKER_05: 'Alice' };
    await detectAndPromptMerges(mapping);
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Merge SPEAKER_10 into SPEAKER_05'),
      }),
    );
  });
});
