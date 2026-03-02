import type {
  SynthesisResult,
  MeetingNotesDecision,
  MeetingNotesConcept,
  MeetingNotesActionItem,
  MeetingNotesQuestion,
  MeetingNotesTopic,
  SpeakerMapping,
} from '../types/index.js';
import { applySpeakerMapping } from '../lib/utils.js';

export interface WriteNotesParams {
  synthesisResult: SynthesisResult | null | undefined;
  speakerMapping?: SpeakerMapping;
}

function renderDecisions(decisions: MeetingNotesDecision[]): string[] {
  if (decisions.length === 0) return [];
  const lines: string[] = ['## Key Decisions', ''];
  for (const d of decisions) {
    lines.push(`### [${d.timestamp}] ${d.decision}`);
    lines.push('');
    if (d.context.length > 0) {
      lines.push(d.context);
      lines.push('');
    }
  }
  return lines;
}

function renderConcepts(concepts: MeetingNotesConcept[]): string[] {
  if (concepts.length === 0) return [];
  const lines: string[] = ['## Key Concepts', ''];
  for (const c of concepts) {
    lines.push(`### [${c.timestamp}] ${c.concept}`);
    lines.push('');
    if (c.explanation.length > 0) {
      lines.push(c.explanation);
      lines.push('');
    }
  }
  return lines;
}

function renderTopics(topics: MeetingNotesTopic[]): string[] {
  if (topics.length === 0) return [];
  const lines: string[] = ['## Topics', ''];
  for (const t of topics) {
    const tsLabel = t.timestamps.length > 0 ? ` _(${t.timestamps.join(', ')})_` : '';
    lines.push(`### ${t.title}${tsLabel}`);
    lines.push('');
    if (t.summary.length > 0) {
      lines.push(t.summary);
      lines.push('');
    }
    if (t.key_points.length > 0) {
      for (const kp of t.key_points) {
        lines.push(`- ${kp}`);
      }
      lines.push('');
    }
  }
  return lines;
}

function renderQuestions(questions: MeetingNotesQuestion[]): string[] {
  if (questions.length === 0) return [];
  const lines: string[] = ['## Questions Raised', ''];
  for (const q of questions) {
    const status = q.answered ? '(answered)' : '(open)';
    lines.push(`- **[${q.timestamp}]** ${q.question} ${status}`);
  }
  lines.push('');
  return lines;
}

function renderActionItems(items: MeetingNotesActionItem[], speakerMapping?: SpeakerMapping): string[] {
  if (items.length === 0) return [];
  const lines: string[] = ['## Action Items', ''];
  for (const a of items) {
    const mentionedBy = applySpeakerMapping(a.mentioned_by, speakerMapping);
    const by = mentionedBy.length > 0 ? ` — _${mentionedBy}_` : '';
    lines.push(`- **[${a.timestamp}]** ${a.item}${by}`);
  }
  lines.push('');
  return lines;
}

function hasMeaningfulContent(s: SynthesisResult): boolean {
  return (
    s.key_concepts.length > 0 ||
    s.key_decisions.length > 0 ||
    s.topics.length > 0 ||
    s.questions_raised.length > 0 ||
    s.action_items.length > 0
  );
}

export function writeNotes(params: WriteNotesParams): string | null {
  const { synthesisResult, speakerMapping } = params;
  if (synthesisResult == null) return null;
  if (!hasMeaningfulContent(synthesisResult)) return null;

  const sections: string[] = ['# Notes', ''];

  if (synthesisResult.overview.length > 0) {
    sections.push(synthesisResult.overview);
    sections.push('');
  }

  sections.push(...renderDecisions(synthesisResult.key_decisions));
  sections.push(...renderConcepts(synthesisResult.key_concepts));
  sections.push(...renderTopics(synthesisResult.topics));
  sections.push(...renderQuestions(synthesisResult.questions_raised));
  sections.push(...renderActionItems(synthesisResult.action_items, speakerMapping));

  // Trim trailing blank lines
  while (sections[sections.length - 1] === '') sections.pop();

  return sections.join('\n');
}
