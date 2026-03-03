import type { SegmentResult, EmotionalShift, EmphasisPattern, SpeakerMapping } from '../types/index.js';
import { replaceNamesInText } from '../lib/utils.js';

export interface WriteInsightsParams {
  segments: SegmentResult[];
  speakerMapping?: SpeakerMapping;
}

function collectEmotionalShifts(segments: SegmentResult[]): EmotionalShift[] {
  const shifts: EmotionalShift[] = [];
  for (const seg of segments) {
    if (seg.pass3d != null) {
      shifts.push(...seg.pass3d.emotional_shifts);
    }
  }
  return shifts;
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

function renderEmotionalShifts(shifts: EmotionalShift[], speakerMapping?: SpeakerMapping): string[] {
  if (shifts.length === 0) return [];
  const lines: string[] = ['## Emotional Shifts', ''];
  for (const s of shifts) {
    lines.push(`- **[${s.timestamp}]** ${s.from_state} → ${s.to_state}`);
    if (s.trigger.length > 0) {
      lines.push(`  _Trigger: ${replaceNamesInText(s.trigger, speakerMapping)}_`);
    }
  }
  lines.push('');
  return lines;
}

function renderEmphasisPatterns(patterns: EmphasisPattern[], speakerMapping?: SpeakerMapping): string[] {
  if (patterns.length === 0) return [];
  // Sort by most mentioned first
  const sorted = [...patterns].sort((a, b) => b.times_mentioned - a.times_mentioned);
  const lines: string[] = ['## Emphasis Patterns', ''];
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

export function writeInsights(params: WriteInsightsParams): string | null {
  const { segments, speakerMapping } = params;

  const hasPass3d = segments.some((s) => s.pass3d != null);
  if (!hasPass3d) return null;

  const emotionalShifts = collectEmotionalShifts(segments);
  const emphasisPatterns = collectEmphasisPatterns(segments);
  const implicitQuestions = collectImplicitQuestions(segments);
  const implicitDecisions = collectImplicitDecisions(segments);

  if (
    emotionalShifts.length === 0 &&
    emphasisPatterns.length === 0 &&
    implicitQuestions.length === 0 &&
    implicitDecisions.length === 0
  ) {
    return null;
  }

  const sections: string[] = ['# Insights', ''];

  sections.push(...renderEmotionalShifts(emotionalShifts, speakerMapping));
  sections.push(...renderEmphasisPatterns(emphasisPatterns, speakerMapping));
  sections.push(...renderImplicitQuestions(implicitQuestions, speakerMapping));
  sections.push(...renderImplicitDecisions(implicitDecisions, speakerMapping));

  // Trim trailing blank lines
  while (sections[sections.length - 1] === '') sections.pop();

  return sections.join('\n');
}
