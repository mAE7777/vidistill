import { changeTypeBadge, parseTimestamp } from '../lib/utils.js';
import type { PipelineResult, TranscriptEntry, CodeBlock, VisualNote } from '../types/index.js';

export interface WriteCombinedParams {
  pipelineResult: PipelineResult;
}

type EventKind = 'speech' | 'code' | 'visual';

interface TimelineEvent {
  timestamp: string;
  kind: EventKind;
  segmentIndex: number;
  data: TranscriptEntry | CodeBlock | VisualNote;
}

function renderSpeechEvent(entry: TranscriptEntry): string {
  let text = entry.text;
  if (entry.emphasis_words != null && entry.emphasis_words.length > 0) {
    for (const word of entry.emphasis_words) {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?<![\\w*])${escaped}(?![\\w*])`, 'gi');
      text = text.replace(re, `**$&**`);
    }
  }
  return `> **[${entry.timestamp}]** ${entry.speaker}: ${text}`;
}

function renderCodeEvent(block: CodeBlock): string {
  const badge = changeTypeBadge(block.change_type);
  const linesInfo = block.lines_changed != null ? ` (${block.lines_changed})` : '';
  const lines: string[] = [
    `**[${block.timestamp}]** ${badge} \`${block.filename}\` (${block.language})${linesInfo}`,
  ];
  if (block.instructor_explanation.length > 0) {
    lines.push(`> _${block.instructor_explanation}_`);
  }
  lines.push('');
  lines.push('```' + block.language);
  lines.push(block.content);
  lines.push('```');
  return lines.join('\n');
}

function renderVisualEvent(note: VisualNote): string {
  return `_[${note.timestamp}]_ **${note.visual_type}:** ${note.description}`;
}

function renderEvent(event: TimelineEvent): string {
  switch (event.kind) {
    case 'speech':
      return renderSpeechEvent(event.data as TranscriptEntry);
    case 'code':
      return renderCodeEvent(event.data as CodeBlock);
    case 'visual':
      return renderVisualEvent(event.data as VisualNote);
  }
}

export function writeCombined(params: WriteCombinedParams): string {
  const { pipelineResult } = params;
  const { segments } = pipelineResult;

  const sections: string[] = ['# Combined View', '', '_Chronological interleaving of speech, code, and visuals._', ''];

  for (const seg of segments) {
    const { pass1, pass2 } = seg;
    const timeRange = pass1?.time_range ?? pass2?.time_range ?? `Segment ${seg.index + 1}`;

    sections.push(`## Segment ${seg.index + 1} — ${timeRange}`);
    sections.push('');

    // Collect all events for this segment
    const events: TimelineEvent[] = [];

    if (pass1 != null) {
      for (const entry of pass1.transcript_entries) {
        events.push({ timestamp: entry.timestamp, kind: 'speech', segmentIndex: seg.index, data: entry });
      }
    }

    if (pass2 != null) {
      for (const block of pass2.code_blocks) {
        events.push({ timestamp: block.timestamp, kind: 'code', segmentIndex: seg.index, data: block });
      }
      for (const note of pass2.visual_notes) {
        events.push({ timestamp: note.timestamp, kind: 'visual', segmentIndex: seg.index, data: note });
      }
    }

    if (events.length === 0) {
      sections.push('_No data available for this segment._');
      sections.push('');
      continue;
    }

    // Sort chronologically; within same timestamp: speech first, then code, then visual
    const kindOrder: Record<EventKind, number> = { speech: 0, code: 1, visual: 2 };
    events.sort((a, b) => {
      const tDiff = parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp);
      if (tDiff !== 0) return tDiff;
      return kindOrder[a.kind] - kindOrder[b.kind];
    });

    for (const event of events) {
      sections.push(renderEvent(event));
      sections.push('');
    }
  }

  // Trim trailing blank lines
  while (sections[sections.length - 1] === '') sections.pop();

  return sections.join('\n');
}
