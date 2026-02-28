import type { PipelineResult, TranscriptEntry, Pass1Result } from '../types/index.js';

export interface WriteTranscriptParams {
  pipelineResult: PipelineResult;
}

const PAUSE_THRESHOLD_SECONDS = 1.5;

function applyEmphasis(text: string, emphasisWords: string[] | undefined): string {
  if (emphasisWords == null || emphasisWords.length === 0) return text;

  let result = text;
  for (const word of emphasisWords) {
    // Escape special regex characters in the word
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match whole word occurrences (case-insensitive), wrap with bold markers
    const re = new RegExp(`(?<![\\w*])${escaped}(?![\\w*])`, 'gi');
    result = result.replace(re, `**$&**`);
  }
  return result;
}

function renderEntry(entry: TranscriptEntry): string {
  const emphasized = applyEmphasis(entry.text, entry.emphasis_words);
  const pause =
    entry.pause_after_seconds != null && entry.pause_after_seconds >= PAUSE_THRESHOLD_SECONDS
      ? ` _(pause ${entry.pause_after_seconds.toFixed(1)}s)_`
      : '';
  return `**[${entry.timestamp}]** **${entry.speaker}:** ${emphasized}${pause}`;
}

function renderPass1(pass1: Pass1Result): string {
  const lines: string[] = [];

  lines.push(`### Segment ${pass1.segment_index + 1} — ${pass1.time_range}`);
  lines.push('');

  if (pass1.speaker_summary.length > 0) {
    lines.push('_Speakers: ' + pass1.speaker_summary.map((s) => `${s.speaker_id} (${s.description})`).join(', ') + '_');
    lines.push('');
  }

  if (pass1.transcript_entries.length === 0) {
    lines.push('_No transcript entries for this segment._');
  } else {
    for (const entry of pass1.transcript_entries) {
      lines.push(renderEntry(entry));
    }
  }

  return lines.join('\n');
}

export function writeTranscript(params: WriteTranscriptParams): string {
  const { pipelineResult } = params;
  const { segments } = pipelineResult;

  const sections: string[] = ['# Transcript', ''];

  const segmentsWithPass1 = segments.filter((s) => s.pass1 != null);

  if (segmentsWithPass1.length === 0) {
    sections.push('_No transcript data available._');
    return sections.join('\n');
  }

  for (const seg of segmentsWithPass1) {
    if (seg.pass1 != null) {
      sections.push(renderPass1(seg.pass1));
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
