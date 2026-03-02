import type { PipelineResult, TranscriptEntry, Pass1Result, SpeakerMapping } from '../types/index.js';
import { applySpeakerMapping } from '../lib/utils.js';

export interface WriteTranscriptParams {
  pipelineResult: PipelineResult;
  speakerMapping?: SpeakerMapping;
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

function renderEntry(entry: TranscriptEntry, speakerMapping?: SpeakerMapping): string {
  const emphasized = applyEmphasis(entry.text, entry.emphasis_words);
  const pause =
    entry.pause_after_seconds != null && entry.pause_after_seconds >= PAUSE_THRESHOLD_SECONDS
      ? ` _(pause ${entry.pause_after_seconds.toFixed(1)}s)_`
      : '';
  const speaker = applySpeakerMapping(entry.speaker, speakerMapping);
  return `**[${entry.timestamp}]** **${speaker}:** ${emphasized}${pause}`;
}

function renderPass1(pass1: Pass1Result, speakerMapping?: SpeakerMapping): string {
  const lines: string[] = [];

  lines.push(`### Segment ${pass1.segment_index + 1} — ${pass1.time_range}`);
  lines.push('');

  if (pass1.speaker_summary.length > 0) {
    lines.push(
      '_Speakers: ' +
        pass1.speaker_summary
          .map((s) => `${applySpeakerMapping(s.speaker_id, speakerMapping)} (${s.description})`)
          .join(', ') +
        '_',
    );
    lines.push('');
  }

  if (pass1.transcript_entries.length === 0) {
    lines.push('_No transcript entries for this segment._');
  } else {
    for (const entry of pass1.transcript_entries) {
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
