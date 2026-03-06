import type {
  SynthesisResult,
  SegmentResult,
  EmphasisPattern,
  MeetingNotesDecision,
  MeetingNotesConcept,
  MeetingNotesActionItem,
  MeetingNotesQuestion,
  MeetingNotesTopic,
  SpeakerMapping,
} from '../types/index.js';
import { applySpeakerMapping, replaceNamesInText } from '../lib/utils.js';

export interface WriteNotesParams {
  synthesisResult: SynthesisResult | null | undefined;
  segments?: SegmentResult[];
  speakerMapping?: SpeakerMapping;
}

function renderDecisions(decisions: MeetingNotesDecision[], speakerMapping?: SpeakerMapping): string[] {
  if (decisions.length === 0) return [];
  const lines: string[] = ['## Key Decisions', ''];
  for (const d of decisions) {
    lines.push(`### [${d.timestamp}] ${replaceNamesInText(d.decision, speakerMapping)}`);
    lines.push('');
    if (d.context.length > 0) {
      lines.push(replaceNamesInText(d.context, speakerMapping));
      lines.push('');
    }
  }
  return lines;
}

function renderConcepts(concepts: MeetingNotesConcept[], speakerMapping?: SpeakerMapping): string[] {
  if (concepts.length === 0) return [];
  const lines: string[] = ['## Key Concepts', ''];
  for (const c of concepts) {
    lines.push(`### [${c.timestamp}] ${replaceNamesInText(c.concept, speakerMapping)}`);
    lines.push('');
    if (c.explanation.length > 0) {
      lines.push(replaceNamesInText(c.explanation, speakerMapping));
      lines.push('');
    }
  }
  return lines;
}

function renderTopics(topics: MeetingNotesTopic[], speakerMapping?: SpeakerMapping): string[] {
  if (topics.length === 0) return [];
  const lines: string[] = ['## Topics', ''];
  for (const t of topics) {
    const tsLabel = t.timestamps.length > 0 ? ` _(${t.timestamps.join(', ')})_` : '';
    lines.push(`### ${replaceNamesInText(t.title, speakerMapping)}${tsLabel}`);
    lines.push('');
    if (t.summary.length > 0) {
      lines.push(replaceNamesInText(t.summary, speakerMapping));
      lines.push('');
    }
    if (t.key_points.length > 0) {
      for (const kp of t.key_points) {
        lines.push(`- ${replaceNamesInText(kp, speakerMapping)}`);
      }
      lines.push('');
    }
  }
  return lines;
}

function renderQuestions(questions: MeetingNotesQuestion[], speakerMapping?: SpeakerMapping): string[] {
  if (questions.length === 0) return [];
  const lines: string[] = ['## Questions Raised', ''];
  for (const q of questions) {
    const status = q.answered ? '(answered)' : '(open)';
    lines.push(`- **[${q.timestamp}]** ${replaceNamesInText(q.question, speakerMapping)} ${status}`);
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
    lines.push(`- **[${a.timestamp}]** ${replaceNamesInText(a.item, speakerMapping)}${by}`);
  }
  lines.push('');
  return lines;
}

function collectImplicitQuestions(segments: SegmentResult[]): string[] {
  const questions: string[] = [];
  for (const seg of segments) {
    if (seg.pass3d != null) {
      questions.push(...seg.pass3d.questions_implicit);
    }
  }
  return questions;
}

function collectImplicitDecisions(segments: SegmentResult[]): string[] {
  const decisions: string[] = [];
  for (const seg of segments) {
    if (seg.pass3d != null) {
      decisions.push(...seg.pass3d.decisions_implicit);
    }
  }
  return decisions;
}

function collectEmphasisPatterns(segments: SegmentResult[]): EmphasisPattern[] {
  const patterns: EmphasisPattern[] = [];
  for (const seg of segments) {
    if (seg.pass3d != null) {
      patterns.push(...seg.pass3d.emphasis_patterns);
    }
  }
  return patterns;
}

function renderImplicitQuestions(questions: string[], speakerMapping?: SpeakerMapping): string[] {
  if (questions.length === 0) return [];
  const lines: string[] = ['## Implicit Questions', ''];
  for (const q of questions) {
    lines.push(`- ${replaceNamesInText(q, speakerMapping)}`);
  }
  lines.push('');
  return lines;
}

function renderImplicitDecisions(decisions: string[], speakerMapping?: SpeakerMapping): string[] {
  if (decisions.length === 0) return [];
  const lines: string[] = ['## Implicit Decisions', ''];
  for (const d of decisions) {
    lines.push(`- ${replaceNamesInText(d, speakerMapping)}`);
  }
  lines.push('');
  return lines;
}

function renderRecurringThemes(patterns: EmphasisPattern[], speakerMapping?: SpeakerMapping): string[] {
  if (patterns.length === 0) return [];
  const sorted = [...patterns].sort((a, b) => b.times_mentioned - a.times_mentioned);
  const lines: string[] = ['## Recurring Themes', ''];
  for (const p of sorted) {
    const ts = p.timestamps.length > 0 ? ` _(${p.timestamps.join(', ')})_` : '';
    lines.push(`### ${p.concept} (×${p.times_mentioned})${ts}`);
    lines.push('');
    if (p.significance.length > 0) {
      lines.push(replaceNamesInText(p.significance, speakerMapping));
      lines.push('');
    }
  }
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

function hasPass3dContent(segments: SegmentResult[]): boolean {
  return segments.some(
    (s) =>
      s.pass3d != null &&
      (s.pass3d.questions_implicit.length > 0 ||
        s.pass3d.decisions_implicit.length > 0 ||
        s.pass3d.emphasis_patterns.length > 0),
  );
}

export function writeNotes(params: WriteNotesParams): string | null {
  const { synthesisResult, segments, speakerMapping } = params;
  if (synthesisResult == null) return null;

  const hasPass3d = segments != null && hasPass3dContent(segments);
  if (!hasMeaningfulContent(synthesisResult) && !hasPass3d) return null;

  const sections: string[] = ['# Notes', ''];

  if (synthesisResult.overview.length > 0) {
    sections.push(replaceNamesInText(synthesisResult.overview, speakerMapping));
    sections.push('');
  }

  sections.push(...renderDecisions(synthesisResult.key_decisions, speakerMapping));
  sections.push(...renderConcepts(synthesisResult.key_concepts, speakerMapping));
  sections.push(...renderTopics(synthesisResult.topics, speakerMapping));
  sections.push(...renderQuestions(synthesisResult.questions_raised, speakerMapping));
  sections.push(...renderActionItems(synthesisResult.action_items, speakerMapping));

  if (segments != null) {
    sections.push(...renderImplicitQuestions(collectImplicitQuestions(segments), speakerMapping));
    sections.push(...renderImplicitDecisions(collectImplicitDecisions(segments), speakerMapping));
    sections.push(...renderRecurringThemes(collectEmphasisPatterns(segments), speakerMapping));
  }

  // Trim trailing blank lines
  while (sections[sections.length - 1] === '') sections.pop();

  return sections.join('\n');
}
