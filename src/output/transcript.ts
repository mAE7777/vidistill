import type { PipelineResult, TranscriptEntry, Pass1Result, SpeakerMapping } from '../types/index.js';
import { applySpeakerMapping, parseTimestamp } from '../lib/utils.js';
import { isNearDuplicate, trimBoundaryOverlap } from '../core/transcript-consensus.js';

export interface WriteTranscriptParams {
  pipelineResult: PipelineResult;
  speakerMapping?: SpeakerMapping;
}

function renderEntry(entry: TranscriptEntry, speakerMapping?: SpeakerMapping): string {
  const speaker = applySpeakerMapping(entry.speaker, speakerMapping);
  return `**[${entry.timestamp}]** **${speaker}:** ${entry.text}`;
}

/**
 * Parse the end timestamp from a time range string like "00:00:00 - 00:18:06".
 * Returns the end time in seconds, or Infinity if unparseable.
 */
function parseEndTime(timeRange: string): number {
  const parts = timeRange.split('-');
  if (parts.length < 2) return Infinity;
  const endStr = parts[parts.length - 1]!.trim();
  const seconds = parseTimestamp(endStr);
  return seconds > 0 ? seconds : Infinity;
}

function renderPass1(pass1: Pass1Result, speakerMapping?: SpeakerMapping): string {
  const lines: string[] = [];

  lines.push(`### Segment ${pass1.segment_index + 1} — ${pass1.time_range}`);
  lines.push('');

  // Filter entries within the segment's time range to prevent hallucinated trailing content
  const endTime = parseEndTime(pass1.time_range);
  const validEntries = pass1.transcript_entries.filter((entry) => {
    const entryTime = parseTimestamp(entry.timestamp);
    return entryTime <= endTime;
  });

  if (validEntries.length === 0) {
    lines.push('_No transcript entries for this segment._');
  } else {
    for (const entry of validEntries) {
      lines.push(renderEntry(entry, speakerMapping));
    }
  }

  return lines.join('\n');
}

export function writeTranscript(params: WriteTranscriptParams): string {
  const { pipelineResult, speakerMapping } = params;
  const { segments } = pipelineResult;

  const sections: string[] = ['# Transcript', ''];

  const segmentsWithPass1 = segments.filter((s) => s.pass1 != null);

  if (segmentsWithPass1.length === 0) {
    sections.push('_No transcript data available._');
    return sections.join('\n');
  }

  // Cross-segment boundary dedup: remove entries at the start of each segment
  // that are near-duplicates of entries at the end of the previous segment
  for (let i = 1; i < segmentsWithPass1.length; i++) {
    const prev = segmentsWithPass1[i - 1].pass1;
    const curr = segmentsWithPass1[i].pass1;
    if (prev == null || curr == null) continue;

    const tail = prev.transcript_entries.slice(-5);
    curr.transcript_entries = curr.transcript_entries.filter(entry =>
      !tail.some(prevEntry => isNearDuplicate(entry, prevEntry)),
    );

    // Trim boundary overlap on first surviving entry
    if (curr.transcript_entries.length > 0 && prev.transcript_entries.length > 0) {
      const boundaryRegion = [
        prev.transcript_entries[prev.transcript_entries.length - 1],
        curr.transcript_entries[0],
      ];
      const trimmed = trimBoundaryOverlap(boundaryRegion);
      if (trimmed.length < 2) {
        curr.transcript_entries.shift();
      } else if (trimmed[1].text !== curr.transcript_entries[0].text) {
        curr.transcript_entries[0] = { ...curr.transcript_entries[0], text: trimmed[1].text };
      }
    }
  }

  for (const seg of segmentsWithPass1) {
    if (seg.pass1 != null) {
      sections.push(renderPass1(seg.pass1, speakerMapping));
      sections.push('');
      sections.push('---');
      sections.push('');
    }
  }

  // Remove trailing separator
  if (sections[sections.length - 1] === '') sections.pop();
  if (sections[sections.length - 1] === '---') sections.pop();
  if (sections[sections.length - 1] === '') sections.pop();

  return sections.join('\n');
}
