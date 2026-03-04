import { parseTimestamp } from '../lib/utils.js';
import type { Pass1aResult, Pass1bResult, Pass1Result, TranscriptEntry } from '../types/index.js';

const MAX_MATCH_WINDOW_S = 3;

export function mergeTranscriptResults(pass1a: Pass1aResult, pass1b: Pass1bResult): Pass1Result {
  const assignments = pass1b.speaker_assignments.map((a) => ({
    ...a,
    seconds: parseTimestamp(a.timestamp),
    used: false,
  }));

  const transcript_entries: TranscriptEntry[] = pass1a.transcript_entries.map((entry) => {
    const entrySeconds = parseTimestamp(entry.timestamp);

    // Try exact match first (by parsed seconds, not string)
    let bestIdx = -1;
    let bestDelta = Infinity;

    for (let i = 0; i < assignments.length; i++) {
      if (assignments[i].used) continue;
      const delta = Math.abs(assignments[i].seconds - entrySeconds);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }

    let speaker = 'SPEAKER_UNKNOWN';
    if (bestIdx >= 0 && bestDelta <= MAX_MATCH_WINDOW_S) {
      speaker = assignments[bestIdx].speaker;
      assignments[bestIdx].used = true;
    }

    return {
      ...entry,
      speaker,
    };
  });

  return {
    segment_index: pass1a.segment_index,
    time_range: pass1a.time_range,
    transcript_entries,
    speaker_summary: pass1b.speaker_summary,
  };
}
