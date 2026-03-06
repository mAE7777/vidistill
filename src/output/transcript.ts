import type { PipelineResult, TranscriptEntry, Pass1Result, SpeakerMapping } from '../types/index.js';
import { applySpeakerMapping, parseTimestamp } from '../lib/utils.js';

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
