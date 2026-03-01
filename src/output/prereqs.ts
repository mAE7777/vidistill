import type { PrerequisiteConcept } from '../types/index.js';

export interface WritePrereqsParams {
  prerequisites: PrerequisiteConcept[] | undefined;
}

const LEVEL_ORDER: Array<PrerequisiteConcept['assumed_knowledge_level']> = ['advanced', 'intermediate', 'basic'];

const LEVEL_LABELS: Record<PrerequisiteConcept['assumed_knowledge_level'], string> = {
  advanced: 'Advanced',
  intermediate: 'Intermediate',
  basic: 'Basic',
};

function renderLevelSection(
  level: PrerequisiteConcept['assumed_knowledge_level'],
  concepts: PrerequisiteConcept[],
): string[] {
  if (concepts.length === 0) return [];
  const lines: string[] = [`## ${LEVEL_LABELS[level]} Knowledge`, ''];
  for (const c of concepts) {
    lines.push(`### ${c.concept}`);
    lines.push('');
    lines.push(c.brief_explanation);
    lines.push('');
    lines.push(`_First assumed at: ${c.timestamp_first_assumed}_`);
    lines.push('');
  }
  return lines;
}

export function writePrereqs(params: WritePrereqsParams): string | null {
  const { prerequisites } = params;

  if (prerequisites == null || prerequisites.length === 0) return null;

  const grouped = new Map<PrerequisiteConcept['assumed_knowledge_level'], PrerequisiteConcept[]>();
  for (const level of LEVEL_ORDER) {
    grouped.set(level, []);
  }
  for (const c of prerequisites) {
    const bucket = grouped.get(c.assumed_knowledge_level);
    if (bucket != null) {
      bucket.push(c);
    }
  }

  const sections: string[] = ['# Prerequisites', ''];

  for (const level of LEVEL_ORDER) {
    const concepts = grouped.get(level) ?? [];
    sections.push(...renderLevelSection(level, concepts));
  }

  // Trim trailing blank lines
  while (sections[sections.length - 1] === '') sections.pop();

  return sections.join('\n');
}
