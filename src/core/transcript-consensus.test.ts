import { describe, it, expect } from 'vitest';
import { runTranscriptionConsensus, runDiarizationConsensus, isNearDuplicate, findSuffixPrefixOverlap, trimBoundaryOverlap } from './transcript-consensus.js';
import type { TranscriptConsensusConfig } from './transcript-consensus.js';
import type { Pass1aResult, Pass1aEntry, Pass1bResult, SpeakerAssignment, SpeakerInfo } from '../types/index.js';

// Factory helpers

function makeEntry(overrides: Partial<Pass1aEntry> = {}): Pass1aEntry {
  return {
    timestamp: '00:01:00',
    text: 'Hello world',
    tone: 'neutral',
    ...overrides,
  };
}

function makeResult(entries: Pass1aEntry[], overrides: Partial<Pass1aResult> = {}): Pass1aResult {
  return {
    segment_index: 0,
    time_range: '00:00:00 - 00:02:00',
    transcript_entries: entries,
    ...overrides,
  };
}

function makeRunFn(results: Array<Pass1aResult | Error>): () => Promise<Pass1aResult> {
  let callIndex = 0;
  return async () => {
    const result = results[callIndex % results.length];
    callIndex++;
    if (result instanceof Error) throw result;
    return result;
  };
}

const DEFAULT_CONFIG: TranscriptConsensusConfig = { runs: 3 };

describe('runTranscriptionConsensus', () => {
  describe('reference timeline selection', () => {
    it('uses the run with the most entries as the reference timeline', async () => {
      // 10, 12, 11 entries — 12-entry run should be reference
      const run1Entries = Array.from({ length: 10 }, (_, i) =>
        makeEntry({ timestamp: `00:0${i}:00`, text: `Entry ${i}` }),
      );
      const run2Entries = Array.from({ length: 12 }, (_, i) =>
        makeEntry({ timestamp: `00:0${i}:00`, text: `Entry ${i}` }),
      );
      const run3Entries = Array.from({ length: 11 }, (_, i) =>
        makeEntry({ timestamp: `00:0${i}:00`, text: `Entry ${i}` }),
      );

      const runFn = makeRunFn([
        makeResult(run1Entries),
        makeResult(run2Entries),
        makeResult(run3Entries),
      ]);

      const { result } = await runTranscriptionConsensus({ config: DEFAULT_CONFIG, runFn });

      expect(result).not.toBeNull();
      expect(result!.transcript_entries).toHaveLength(12);
    });
  });

  describe('timestamp alignment', () => {
    it('groups entries within 1-second delta together', async () => {
      const entry1 = makeEntry({ timestamp: '00:01:05', text: 'The quick brown fox' });
      const entry2 = makeEntry({ timestamp: '00:01:06', text: 'The quick brown fox jumps' });

      const run1 = makeResult([entry1]);
      const run2 = makeResult([entry2]);
      const run3 = makeResult([entry1]);

      const runFn = makeRunFn([run1, run2, run3]);

      const { result } = await runTranscriptionConsensus({ config: DEFAULT_CONFIG, runFn });

      expect(result).not.toBeNull();
      // Entries should be aligned — only 1 merged entry
      expect(result!.transcript_entries).toHaveLength(1);
      expect(result!.transcript_entries[0].timestamp).toBe('00:01:05');
    });

    it('includes unmatched entries with only their own text when no partner within 3s', async () => {
      // run1 has entry at 00:01:05, run2 has entry at 00:01:15 (10s away) — too far
      const entry1 = makeEntry({ timestamp: '00:01:05', text: 'Unique entry' });
      const entry2 = makeEntry({ timestamp: '00:01:15', text: 'Different entry' });

      // run1 is reference (same count here; both 1), entry1 won't match entry2 (>3s)
      const run1 = makeResult([entry1]);
      const run2 = makeResult([entry2]);
      const run3 = makeResult([]);

      const runFn = makeRunFn([run1, run2, run3]);

      const { result } = await runTranscriptionConsensus({ config: DEFAULT_CONFIG, runFn });

      expect(result).not.toBeNull();
      // Reference run has 1 entry — no match in run2 (>3s), so entry uses only its own text
      expect(result!.transcript_entries).toHaveLength(1);
      expect(result!.transcript_entries[0].text).toBe('Unique entry');
    });
  });

  describe('text selection', () => {
    it('selects the longest text with highest overlap', async () => {
      const textA = 'The quick brown fox';
      const textB = 'The quick brown dog';
      const textC = 'The quick brown fox jumps';

      const entry = makeEntry({ timestamp: '00:01:00' });
      const run1 = makeResult([{ ...entry, text: textA }]);
      const run2 = makeResult([{ ...entry, text: textB }]);
      const run3 = makeResult([{ ...entry, text: textC }]);

      const runFn = makeRunFn([run1, run2, run3]);

      const { result } = await runTranscriptionConsensus({ config: DEFAULT_CONFIG, runFn });

      expect(result).not.toBeNull();
      // textC has the most tokens in common with the combined reference and is longest
      expect(result!.transcript_entries[0].text).toBe(textC);
    });
  });

  describe('failure handling', () => {
    it('returns the single successful run as-is when 2 of 3 runs fail', async () => {
      const entries = [
        makeEntry({ timestamp: '00:00:10', text: 'Solo entry' }),
        makeEntry({ timestamp: '00:00:20', text: 'Another entry' }),
      ];
      const successRun = makeResult(entries);

      const runFn = makeRunFn([
        successRun,
        new Error('API error'),
        new Error('API error'),
      ]);

      const { result, runsCompleted, runsAttempted } = await runTranscriptionConsensus({
        config: DEFAULT_CONFIG,
        runFn,
      });

      expect(result).not.toBeNull();
      expect(result!.transcript_entries).toHaveLength(2);
      expect(runsCompleted).toBe(1);
      expect(runsAttempted).toBe(3);
    });

    it('returns null when all 3 runs fail', async () => {
      const runFn = makeRunFn([
        new Error('API error'),
        new Error('API error'),
        new Error('API error'),
      ]);

      const { result, runsCompleted, runsAttempted } = await runTranscriptionConsensus({
        config: DEFAULT_CONFIG,
        runFn,
      });

      expect(result).toBeNull();
      expect(runsCompleted).toBe(0);
      expect(runsAttempted).toBe(3);
    });
  });

  describe('single-run mode', () => {
    it('returns the single result directly without merging', async () => {
      const config: TranscriptConsensusConfig = { runs: 1 };
      const entries = [makeEntry({ timestamp: '00:00:05', text: 'Only run' })];
      const singleRun = makeResult(entries);

      const runFn = makeRunFn([singleRun]);

      const { result, runsCompleted, runsAttempted } = await runTranscriptionConsensus({
        config,
        runFn,
      });

      expect(result).not.toBeNull();
      expect(result!.transcript_entries).toHaveLength(1);
      expect(result!.transcript_entries[0].text).toBe('Only run');
      expect(runsCompleted).toBe(1);
      expect(runsAttempted).toBe(1);
    });
  });

  describe('asymmetric dedup', () => {
    it('isNearDuplicate detects short entry as subset of longer entry', () => {
      const long = { timestamp: '00:01:00', text: 'The quick brown fox jumps over the lazy dog' };
      const short = { timestamp: '00:01:03', text: 'The quick brown fox jumps' };
      expect(isNearDuplicate(long, short)).toBe(true);
      expect(isNearDuplicate(short, long)).toBe(true);
    });

    it('detects near-duplicate with different casing', () => {
      const longer = {
        timestamp: '00:11:40',
        text: 'And now the American military is forced to retreat. Well, the moment that the American Empire dies, the Empire of Israel is born.',
      };
      const shorter = {
        timestamp: '00:11:49',
        text: 'Well, the moment that the American empire dies, the empire of Israel is born. Why?',
      };
      expect(isNearDuplicate(longer, shorter)).toBe(true);
      expect(isNearDuplicate(shorter, longer)).toBe(true);
    });

    it('deduplicates asymmetric entries during consensus merge', async () => {
      const longEntry = makeEntry({
        timestamp: '00:01:00',
        text: 'The quick brown fox jumps over the lazy dog',
      });
      const shortEntry = makeEntry({
        timestamp: '00:01:03',
        text: 'The quick brown fox jumps',
      });

      const run = makeResult([longEntry, shortEntry]);
      const runFn = makeRunFn([run, run, run]);

      const { result } = await runTranscriptionConsensus({
        config: DEFAULT_CONFIG,
        runFn,
      });

      expect(result).not.toBeNull();
      // Short entry is a subset of long entry — should be deduped to 1 entry
      expect(result!.transcript_entries).toHaveLength(1);
      // The longer entry is kept
      expect(result!.transcript_entries[0].text).toBe('The quick brown fox jumps over the lazy dog');
    });
  });

  describe('entry metadata preservation', () => {
    it('preserves tone, emphasis_words, and pause_after_seconds from the best entry', async () => {
      const entry = makeEntry({
        timestamp: '00:01:00',
        text: 'The quick brown fox jumps',
        tone: 'excited',
        emphasis_words: ['fox', 'jumps'],
        pause_after_seconds: 1.5,
      });

      const run1 = makeResult([entry]);
      const run2 = makeResult([{ ...entry, text: 'The quick brown fox' }]);
      const run3 = makeResult([entry]);

      const runFn = makeRunFn([run1, run2, run3]);

      const { result } = await runTranscriptionConsensus({ config: DEFAULT_CONFIG, runFn });

      expect(result).not.toBeNull();
      const merged = result!.transcript_entries[0];
      expect(merged.tone).toBe('excited');
      expect(merged.emphasis_words).toEqual(['fox', 'jumps']);
      expect(merged.pause_after_seconds).toBe(1.5);
    });
  });

  describe('onProgress callback', () => {
    it('calls onProgress after each run with correct run number and total', async () => {
      const run = makeResult([makeEntry()]);
      const runFn = makeRunFn([run, run, run]);

      const progressCalls: [number, number][] = [];
      await runTranscriptionConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        onProgress: (r, t) => { progressCalls.push([r, t]); },
      });

      expect(progressCalls).toEqual([[1, 3], [2, 3], [3, 3]]);
    });

    it('calls onProgress even when a run fails', async () => {
      const runFn = makeRunFn([
        new Error('fail'),
        new Error('fail'),
        new Error('fail'),
      ]);

      const progressCalls: number[] = [];
      await runTranscriptionConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        onProgress: (r) => { progressCalls.push(r); },
      });

      expect(progressCalls).toEqual([1, 2, 3]);
    });
  });
});

// --- Diarization consensus helpers ---

function makeSpeakerAssignment(overrides: Partial<SpeakerAssignment> = {}): SpeakerAssignment {
  return {
    timestamp: '00:01:00',
    speaker: 'SPEAKER_00',
    ...overrides,
  };
}

function makeSpeakerInfo(overrides: Partial<SpeakerInfo> = {}): SpeakerInfo {
  return {
    speaker_id: 'SPEAKER_00',
    description: 'Main speaker',
    ...overrides,
  };
}

function makePass1bResult(
  assignments: SpeakerAssignment[],
  summary: SpeakerInfo[] = [],
): Pass1bResult {
  return { speaker_assignments: assignments, speaker_summary: summary };
}

function makeDiarizationRunFn(
  results: Array<Pass1bResult | Error>,
): () => Promise<Pass1bResult> {
  let callIndex = 0;
  return async () => {
    const result = results[callIndex % results.length];
    callIndex++;
    if (result instanceof Error) throw result;
    return result;
  };
}

function makePass1aResult(timestamps: string[]): Pass1aResult {
  return makeResult(timestamps.map((ts) => makeEntry({ timestamp: ts, text: 'text' })));
}

describe('runDiarizationConsensus', () => {
  describe('majority vote', () => {
    it('assigns the majority speaker when 2 of 3 runs agree', async () => {
      const mergedPass1a = makePass1aResult(['00:01:05']);
      const run1 = makePass1bResult([makeSpeakerAssignment({ timestamp: '00:01:05', speaker: 'SPEAKER_00' })]);
      const run2 = makePass1bResult([makeSpeakerAssignment({ timestamp: '00:01:05', speaker: 'SPEAKER_00' })]);
      const run3 = makePass1bResult([makeSpeakerAssignment({ timestamp: '00:01:05', speaker: 'SPEAKER_01' })]);

      const runFn = makeDiarizationRunFn([run1, run2, run3]);
      const result = await runDiarizationConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        mergedPass1a,
      });

      expect(result).not.toBeNull();
      expect(result!.speaker_assignments).toHaveLength(1);
      expect(result!.speaker_assignments[0].speaker).toBe('SPEAKER_00');
    });

    it('uses the first run label on a 3-way tie', async () => {
      const mergedPass1a = makePass1aResult(['00:01:05']);
      const run1 = makePass1bResult([makeSpeakerAssignment({ timestamp: '00:01:05', speaker: 'SPEAKER_00' })]);
      const run2 = makePass1bResult([makeSpeakerAssignment({ timestamp: '00:01:05', speaker: 'SPEAKER_01' })]);
      const run3 = makePass1bResult([makeSpeakerAssignment({ timestamp: '00:01:05', speaker: 'SPEAKER_02' })]);

      const runFn = makeDiarizationRunFn([run1, run2, run3]);
      const result = await runDiarizationConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        mergedPass1a,
      });

      expect(result).not.toBeNull();
      expect(result!.speaker_assignments[0].speaker).toBe('SPEAKER_00');
    });
  });

  describe('speaker summary merging', () => {
    it('keeps the longer description when merging speaker summaries', async () => {
      const mergedPass1a = makePass1aResult(['00:01:00']);

      const run1 = makePass1bResult(
        [makeSpeakerAssignment({ timestamp: '00:01:00', speaker: 'SPEAKER_00' })],
        [makeSpeakerInfo({ speaker_id: 'SPEAKER_00', description: 'Female presenter' })],
      );
      const run2 = makePass1bResult(
        [makeSpeakerAssignment({ timestamp: '00:01:00', speaker: 'SPEAKER_00' })],
        [makeSpeakerInfo({ speaker_id: 'SPEAKER_00', description: 'Lead speaker, female' })],
      );
      const run3 = makePass1bResult(
        [makeSpeakerAssignment({ timestamp: '00:01:00', speaker: 'SPEAKER_00' })],
        [],
      );

      const runFn = makeDiarizationRunFn([run1, run2, run3]);
      const result = await runDiarizationConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        mergedPass1a,
      });

      expect(result).not.toBeNull();
      expect(result!.speaker_summary).toHaveLength(1);
      expect(result!.speaker_summary[0].description).toBe('Lead speaker, female');
    });
  });

  describe('failure handling', () => {
    it('returns the single successful run as-is when 2 of 3 runs fail', async () => {
      const mergedPass1a = makePass1aResult(['00:01:00']);
      const successRun = makePass1bResult(
        [makeSpeakerAssignment({ timestamp: '00:01:00', speaker: 'SPEAKER_00' })],
        [makeSpeakerInfo()],
      );

      const runFn = makeDiarizationRunFn([
        successRun,
        new Error('API error'),
        new Error('API error'),
      ]);

      const result = await runDiarizationConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        mergedPass1a,
      });

      expect(result).not.toBeNull();
      expect(result).toBe(successRun);
    });

    it('returns null when all 3 runs fail', async () => {
      const mergedPass1a = makePass1aResult(['00:01:00']);

      const runFn = makeDiarizationRunFn([
        new Error('API error'),
        new Error('API error'),
        new Error('API error'),
      ]);

      const result = await runDiarizationConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        mergedPass1a,
      });

      expect(result).toBeNull();
    });
  });
});

// --- Boundary overlap trimming ---

describe('findSuffixPrefixOverlap', () => {
  it('returns overlap length for exact suffix-prefix match', () => {
    const prev = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const curr = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
    expect(findSuffixPrefixOverlap(prev, curr)).toBe(10);
  });

  it('returns 0 when no overlap', () => {
    const prev = ['a', 'b', 'c', 'd', 'e'];
    const curr = ['f', 'g', 'h', 'i', 'j'];
    expect(findSuffixPrefixOverlap(prev, curr)).toBe(0);
  });

  it('returns 0 when match is below threshold (4 words)', () => {
    const prev = ['a', 'b', 'c', 'x', 'y', 'z', 'w'];
    const curr = ['y', 'z', 'w', 'q'];
    // only 3 words match at suffix/prefix — below MIN_OVERLAP_WORDS=5
    expect(findSuffixPrefixOverlap(prev, curr)).toBe(0);
  });

  it('returns 5 at exact threshold', () => {
    const prev = ['a', 'b', 'c', 'd', 'e'];
    const curr = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(findSuffixPrefixOverlap(prev, curr)).toBe(5);
  });

  it('finds longest valid match when partial breaks mid-sequence', () => {
    // prev suffix: x p q r s t
    // curr prefix: p q r s t u
    // longest overlap = 5 (p q r s t)
    const prev = ['x', 'p', 'q', 'r', 's', 't'];
    const curr = ['p', 'q', 'r', 's', 't', 'u'];
    expect(findSuffixPrefixOverlap(prev, curr)).toBe(5);
  });

  it('returns 0 for empty arrays', () => {
    expect(findSuffixPrefixOverlap([], [])).toBe(0);
    expect(findSuffixPrefixOverlap(['a'], [])).toBe(0);
    expect(findSuffixPrefixOverlap([], ['a'])).toBe(0);
  });

  it('returns 0 when one array is shorter than MIN_OVERLAP', () => {
    const prev = ['a', 'b', 'c'];
    const curr = ['a', 'b', 'c', 'd'];
    expect(findSuffixPrefixOverlap(prev, curr)).toBe(0);
  });
});

describe('trimBoundaryOverlap', () => {
  it('trims overlapping prefix from second entry', () => {
    const entries = [
      { timestamp: '00:01:00', text: 'alpha beta gamma delta epsilon' },
      { timestamp: '00:01:10', text: 'alpha beta gamma delta epsilon zeta eta' },
    ];
    const result = trimBoundaryOverlap(entries);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('alpha beta gamma delta epsilon');
    expect(result[1].text).toBe('zeta eta');
  });

  it('passes through entries with no overlap', () => {
    const entries = [
      { timestamp: '00:01:00', text: 'the quick brown fox jumps' },
      { timestamp: '00:01:10', text: 'over the lazy dog today' },
    ];
    const result = trimBoundaryOverlap(entries);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('the quick brown fox jumps');
    expect(result[1].text).toBe('over the lazy dog today');
  });

  it('passes through entries with below-threshold match (4 words)', () => {
    const entries = [
      { timestamp: '00:01:00', text: 'one two three four' },
      { timestamp: '00:01:05', text: 'one two three four five' },
    ];
    const result = trimBoundaryOverlap(entries);
    // only 4 words match — below threshold
    expect(result).toHaveLength(2);
    expect(result[1].text).toBe('one two three four five');
  });

  it('drops entry when fully absorbed', () => {
    const entries = [
      { timestamp: '00:01:00', text: 'word1 word2 word3 word4 word5 word6' },
      { timestamp: '00:01:08', text: 'word2 word3 word4 word5 word6' },
    ];
    const result = trimBoundaryOverlap(entries);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('word1 word2 word3 word4 word5 word6');
  });

  it('handles cascade trimming (A→B→C)', () => {
    const entries = [
      { timestamp: '00:01:00', text: 'one two three four five six seven' },
      { timestamp: '00:01:10', text: 'three four five six seven eight nine ten' },
      { timestamp: '00:01:20', text: 'six seven eight nine ten eleven twelve' },
    ];
    const result = trimBoundaryOverlap(entries);
    expect(result).toHaveLength(3);
    expect(result[0].text).toBe('one two three four five six seven');
    expect(result[1].text).toBe('eight nine ten');
    // After B is trimmed to "eight nine ten", C's overlap with B is < 5 words
    expect(result[2].text).toBe('six seven eight nine ten eleven twelve');
  });

  it('cleans orphaned leading punctuation after trim', () => {
    const entries = [
      { timestamp: '00:01:00', text: 'the world is changing very rapidly today' },
      { timestamp: '00:01:10', text: 'is changing very rapidly today, so we must adapt' },
    ];
    const result = trimBoundaryOverlap(entries);
    expect(result).toHaveLength(2);
    expect(result[1].text).toBe('so we must adapt');
  });

  it('skips entries with timestamp gap > 30s', () => {
    const entries = [
      { timestamp: '00:01:00', text: 'alpha beta gamma delta epsilon' },
      { timestamp: '00:01:35', text: 'alpha beta gamma delta epsilon zeta' },
    ];
    const result = trimBoundaryOverlap(entries);
    expect(result).toHaveLength(2);
    // No trimming despite text match — too far apart
    expect(result[1].text).toBe('alpha beta gamma delta epsilon zeta');
  });

  it('returns single entry unchanged', () => {
    const entries = [{ timestamp: '00:01:00', text: 'hello world' }];
    const result = trimBoundaryOverlap(entries);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('hello world');
  });

  it('handles case-insensitive matching', () => {
    const entries = [
      { timestamp: '00:01:00', text: 'The American Empire Dies Here Today' },
      { timestamp: '00:01:10', text: 'the american empire dies here today and tomorrow' },
    ];
    const result = trimBoundaryOverlap(entries);
    expect(result).toHaveLength(2);
    expect(result[1].text).toBe('and tomorrow');
  });

  it('preserves metadata fields through trimming', () => {
    const entries = [
      { timestamp: '00:01:00', text: 'alpha beta gamma delta epsilon', tone: 'calm' as const, emphasis_words: ['alpha'] },
      { timestamp: '00:01:10', text: 'alpha beta gamma delta epsilon zeta eta', tone: 'excited' as const, emphasis_words: ['zeta'], pause_after_seconds: 2 },
    ];
    const result = trimBoundaryOverlap(entries);
    expect(result).toHaveLength(2);
    expect(result[1].text).toBe('zeta eta');
    expect(result[1].tone).toBe('excited');
    expect(result[1].emphasis_words).toEqual(['zeta']);
    expect(result[1].pause_after_seconds).toBe(2);
  });

  it('handles real-world overlapping transcript entries', () => {
    const entries = [
      {
        timestamp: '00:04:09',
        text: 'So, this is a war of perception, a war of narrative. And whoever controls the story controls the outcome.',
      },
      {
        timestamp: '00:04:16',
        text: 'And whoever controls the story controls the outcome. Now, what does this mean for the average person?',
      },
    ];
    const result = trimBoundaryOverlap(entries);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('So, this is a war of perception, a war of narrative. And whoever controls the story controls the outcome.');
    expect(result[1].text).toBe('Now, what does this mean for the average person?');
  });
});
