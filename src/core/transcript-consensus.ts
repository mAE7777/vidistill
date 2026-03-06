import { parseTimestamp } from '../lib/utils.js';
import { tokenOverlap } from './consensus.js';
import type { Pass1aResult, Pass1aEntry, Pass1bResult, SpeakerInfo } from '../types/index.js';

export interface TranscriptConsensusConfig {
  runs: number;
}

export interface TranscriptConsensusResult {
  result: Pass1aResult | null;
  runsCompleted: number;
  runsAttempted: number;
}

const ALIGN_WINDOW_S = 3;

/**
 * Select the best text from a group of aligned candidates.
 * Uses token overlap against all other texts; tie-break by longest text.
 */
function selectBestText(texts: string[]): string {
  if (texts.length === 1) return texts[0];

  const referenceText = texts.join(' ');

  let bestText = texts[0];
  let bestScore = -1;

  for (const candidate of texts) {
    const score = tokenOverlap(candidate, referenceText);
    if (
      score > bestScore ||
      (score === bestScore && candidate.length > bestText.length)
    ) {
      bestScore = score;
      bestText = candidate;
    }
  }

  return bestText;
}

/**
 * Merge multiple Pass1aResult runs into a single consensus result.
 * Uses the run with the most entries as the reference timeline.
 * Aligns entries from other runs within a 3-second window.
 */
function mergeTranscriptRuns(runs: Pass1aResult[]): Pass1aResult {
  if (runs.length === 1) return runs[0];

  // Select reference run: the one with the most transcript entries
  const referenceRun = runs.reduce((best, run) =>
    run.transcript_entries.length > best.transcript_entries.length ? run : best,
  );

  // Mark all entries in non-reference runs as unused
  type TrackableEntry = Pass1aEntry & { used: boolean; seconds: number };

  const otherRuns: TrackableEntry[][] = runs
    .filter((r) => r !== referenceRun)
    .map((r) =>
      r.transcript_entries.map((e) => ({
        ...e,
        used: false,
        seconds: parseTimestamp(e.timestamp),
      })),
    );

  const mergedEntries: Pass1aEntry[] = referenceRun.transcript_entries.map((refEntry) => {
    const refSeconds = parseTimestamp(refEntry.timestamp);
    const alignedTexts: string[] = [refEntry.text];
    const alignedEntries: Pass1aEntry[] = [refEntry];

    // Find best matching entry in each other run
    for (const otherEntries of otherRuns) {
      let bestIdx = -1;
      let bestDelta = Infinity;

      for (let i = 0; i < otherEntries.length; i++) {
        const e = otherEntries[i];
        if (e.used) continue;
        const delta = Math.abs(e.seconds - refSeconds);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0 && bestDelta <= ALIGN_WINDOW_S) {
        alignedTexts.push(otherEntries[bestIdx].text);
        alignedEntries.push(otherEntries[bestIdx]);
        otherEntries[bestIdx].used = true;
      }
    }

    // Select best text from aligned candidates
    const bestText = selectBestText(alignedTexts);
    const bestEntry = alignedEntries.find((e) => e.text === bestText) ?? refEntry;

    return {
      timestamp: refEntry.timestamp,
      text: bestText,
      tone: bestEntry.tone,
      ...(bestEntry.emphasis_words !== undefined ? { emphasis_words: bestEntry.emphasis_words } : {}),
      ...(bestEntry.pause_after_seconds !== undefined ? { pause_after_seconds: bestEntry.pause_after_seconds } : {}),
    };
  });

  return {
    segment_index: referenceRun.segment_index,
    time_range: referenceRun.time_range,
    transcript_entries: mergedEntries,
  };
}

/**
 * Merge speaker_summary arrays from multiple diarization runs.
 * Groups by speaker_id, keeps the longest description for each speaker.
 */
function mergeSpeakerSummaries(summaries: SpeakerInfo[][]): SpeakerInfo[] {
  const bySpeakerId = new Map<string, string>();

  for (const summary of summaries) {
    for (const info of summary) {
      const existing = bySpeakerId.get(info.speaker_id);
      if (existing === undefined || info.description.length > existing.length) {
        bySpeakerId.set(info.speaker_id, info.description);
      }
    }
  }

  return Array.from(bySpeakerId.entries()).map(([speaker_id, description]) => ({
    speaker_id,
    description,
  }));
}

/**
 * For a given timestamp, find the speaker label from a run's speaker_assignments
 * using the same 3-second alignment window as transcript merging.
 */
function findSpeakerForTimestamp(
  timestamp: string,
  assignments: Pass1bResult['speaker_assignments'],
): string | undefined {
  const targetSeconds = parseTimestamp(timestamp);
  let bestLabel: string | undefined;
  let bestDelta = Infinity;

  for (const assignment of assignments) {
    const delta = Math.abs(parseTimestamp(assignment.timestamp) - targetSeconds);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestLabel = assignment.speaker;
    }
  }

  return bestDelta <= ALIGN_WINDOW_S ? bestLabel : undefined;
}

/**
 * Run majority-vote consensus over multiple diarization results.
 * Returns a merged Pass1bResult or null if all runs failed.
 */
export async function runDiarizationConsensus(params: {
  config: TranscriptConsensusConfig;
  runFn: () => Promise<Pass1bResult>;
  mergedPass1a: Pass1aResult;
  onProgress?: (run: number, total: number) => void;
}): Promise<Pass1bResult | null> {
  const { config, runFn, mergedPass1a, onProgress } = params;
  const { runs } = config;

  const successfulRuns: Pass1bResult[] = [];

  for (let i = 0; i < runs; i++) {
    try {
      const result = await runFn();
      successfulRuns.push(result);
    } catch {
      // Individual run failures are expected — continue to next run
    }
    onProgress?.(i + 1, runs);
  }

  if (successfulRuns.length === 0) {
    return null;
  }

  if (successfulRuns.length === 1) {
    return successfulRuns[0];
  }

  // Build majority-voted speaker_assignments using mergedPass1a as reference timeline
  const speaker_assignments: Pass1bResult['speaker_assignments'] = [];

  for (const entry of mergedPass1a.transcript_entries) {
    // Collect speaker label from each successful run
    const votes: string[] = [];
    for (const run of successfulRuns) {
      const label = findSpeakerForTimestamp(entry.timestamp, run.speaker_assignments);
      if (label !== undefined) {
        votes.push(label);
      }
    }

    if (votes.length === 0) {
      continue;
    }

    // Majority vote: count occurrences
    const counts = new Map<string, number>();
    for (const vote of votes) {
      counts.set(vote, (counts.get(vote) ?? 0) + 1);
    }

    // Find the highest count; tie-break by first run's label (votes[0])
    let winner = votes[0];
    let winnerCount = counts.get(winner) ?? 0;

    for (const [label, count] of counts) {
      if (count > winnerCount) {
        winnerCount = count;
        winner = label;
      }
    }

    speaker_assignments.push({ timestamp: entry.timestamp, speaker: winner });
  }

  // Merge speaker summaries: union, keep longest description per speaker_id
  const allSummaries = successfulRuns.map((r) => r.speaker_summary);
  const speaker_summary = mergeSpeakerSummaries(allSummaries);

  return { speaker_assignments, speaker_summary };
}

export async function runTranscriptionConsensus(params: {
  config: TranscriptConsensusConfig;
  runFn: () => Promise<Pass1aResult>;
  onProgress?: (run: number, total: number) => void;
}): Promise<TranscriptConsensusResult> {
  const { config, runFn, onProgress } = params;
  const { runs } = config;

  const successfulRuns: Pass1aResult[] = [];

  for (let i = 0; i < runs; i++) {
    try {
      const result = await runFn();
      successfulRuns.push(result);
    } catch {
      // Individual run failures are expected — continue to next run
    }
    onProgress?.(i + 1, runs);
  }

  const runsCompleted = successfulRuns.length;

  if (runsCompleted === 0) {
    return { result: null, runsCompleted: 0, runsAttempted: runs };
  }

  if (runs === 1 && runsCompleted === 1) {
    return { result: successfulRuns[0], runsCompleted: 1, runsAttempted: 1 };
  }

  const merged = mergeTranscriptRuns(successfulRuns);
  return { result: merged, runsCompleted, runsAttempted: runs };
}
