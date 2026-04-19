import { changeTypeBadge, parseTimestamp, applySpeakerMapping } from '../lib/utils.js';
import { isNearDuplicate, trimBoundaryOverlap } from '../core/transcript-consensus.js';
import { tokenOverlap } from '../core/consensus.js';
import type { PipelineResult, TranscriptEntry, CodeBlock, VisualNote, SpeakerMapping, SynthesisResult } from '../types/index.js';

export interface KeyframeEntry {
  timestamp: string;
  path: string;
  description: string;
}

export interface WriteCombinedParams {
  pipelineResult: PipelineResult;
  speakerMapping?: SpeakerMapping;
  synthesisResult?: SynthesisResult;
  keyframes?: KeyframeEntry[];
}

type EventKind = 'speech' | 'code' | 'visual';

interface TimelineEvent {
  timestamp: string;
  kind: EventKind;
  segmentIndex: number;
  data: TranscriptEntry | CodeBlock | VisualNote;
}

function tokenCount(text: string): number {
  return (text.match(/[\p{L}\p{N}_]+/gu) ?? []).length;
}

function collectSynthesisTexts(synthesisResult: SynthesisResult): string[] {
  const texts: string[] = [];
  if (synthesisResult.overview) texts.push(synthesisResult.overview);
  for (const d of synthesisResult.key_decisions) texts.push(d.decision);
  for (const c of synthesisResult.key_concepts) texts.push(c.explanation);
  for (const a of synthesisResult.action_items) texts.push(a.item);
  for (const t of synthesisResult.topics) {
    if (t.summary) texts.push(t.summary);
    for (const kp of t.key_points) texts.push(kp);
  }
  return texts.filter(t => t.length > 0);
}

function hasSynthesisOverlap(speechText: string, synthesisTexts: string[]): boolean {
  const maxTokens = Math.max(tokenCount(speechText), 1);
  for (const synthText of synthesisTexts) {
    const overlap = tokenOverlap(speechText, synthText) / maxTokens;
    if (overlap > 0.6) return true;
  }
  return false;
}

function renderSpeechEvent(entry: TranscriptEntry, speakerMapping?: SpeakerMapping): string {
  let text = entry.text;
  if (entry.emphasis_words != null && entry.emphasis_words.length > 0) {
    for (const word of entry.emphasis_words) {
      // Skip short single words (likely noise from overzealous Gemini emphasis)
      if (!word.includes(' ') && word.length < 4) continue;
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?<![\\w*])${escaped}(?![\\w*])`, 'gi');
      text = text.replace(re, `**$&**`);
    }
  }
  const speaker = applySpeakerMapping(entry.speaker, speakerMapping);
  return `> **[${entry.timestamp}]** ${speaker}: ${text}`;
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

function renderEvent(event: TimelineEvent, speakerMapping?: SpeakerMapping): string {
  switch (event.kind) {
    case 'speech':
      return renderSpeechEvent(event.data as TranscriptEntry, speakerMapping);
    case 'code':
      return renderCodeEvent(event.data as CodeBlock);
    case 'visual':
      return renderVisualEvent(event.data as VisualNote);
  }
}

export function writeCombined(params: WriteCombinedParams): string {
  const { pipelineResult, speakerMapping, synthesisResult, keyframes } = params;
  const { segments } = pipelineResult;
  const synthTexts = synthesisResult != null ? collectSynthesisTexts(synthesisResult) : null;

  // Sort keyframes chronologically; track index for sequential emission
  const sortedKeyframes: KeyframeEntry[] = keyframes != null
    ? [...keyframes].sort((a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp))
    : [];
  let kfIndex = 0;

  const sections: string[] = ['# Combined View', '', '_Chronological interleaving of speech, code, and visuals._', ''];

  // Cross-segment boundary dedup (matching transcript.ts behavior)
  const segmentsWithPass1 = segments.filter(s => s.pass1 != null);
  for (let i = 1; i < segmentsWithPass1.length; i++) {
    const prev = segmentsWithPass1[i - 1].pass1;
    const curr = segmentsWithPass1[i].pass1;
    if (prev == null || curr == null) continue;

    const tail = prev.transcript_entries.slice(-5);
    curr.transcript_entries = curr.transcript_entries.filter(entry =>
      !tail.some(prevEntry => isNearDuplicate(entry, prevEntry)),
    );

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
      // Emit any keyframes whose timestamp is <= this event's timestamp (before the event)
      while (kfIndex < sortedKeyframes.length) {
        const kf = sortedKeyframes[kfIndex];
        if (parseTimestamp(kf.timestamp) <= parseTimestamp(event.timestamp)) {
          sections.push(`![${kf.description}](${kf.path})`);
          sections.push('');
          kfIndex++;
        } else {
          break;
        }
      }

      if (
        event.kind === 'speech' &&
        synthTexts != null &&
        hasSynthesisOverlap((event.data as TranscriptEntry).text, synthTexts)
      ) {
        continue;
      }
      sections.push(renderEvent(event, speakerMapping));
      sections.push('');
    }
  }

  // Emit any remaining keyframes that come after all events
  while (kfIndex < sortedKeyframes.length) {
    const kf = sortedKeyframes[kfIndex];
    sections.push(`![${kf.description}](${kf.path})`);
    sections.push('');
    kfIndex++;
  }

  // Trim trailing blank lines
  while (sections[sections.length - 1] === '') sections.pop();

  return sections.join('\n');
}
