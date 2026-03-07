import { describe, it, expect } from 'vitest';
import { runTranscriptionConsensus, runDiarizationConsensus, isNearDuplicate } from './transcript-consensus.js';
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
      expect(result).toBe(singleRun); // exact same reference — no merging
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
