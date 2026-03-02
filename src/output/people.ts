import type { PeopleExtraction, Participant, SpeakerMapping } from '../types/index.js';
import { applySpeakerMapping } from '../lib/utils.js';

export interface WritePeopleParams {
  peopleExtraction: PeopleExtraction | null | undefined;
  speakerMapping?: SpeakerMapping;
}

function renderParticipant(p: Participant, index: number, speakerMapping?: SpeakerMapping): string[] {
  const lines: string[] = [];
  lines.push(`## ${index + 1}. ${applySpeakerMapping(p.name, speakerMapping)}`);
  lines.push('');

  const meta: string[] = [];
  if (p.role.length > 0) meta.push(`**Role:** ${p.role}`);
  if (p.organization.length > 0) meta.push(`**Organization:** ${p.organization}`);
  for (const m of meta) {
    lines.push(m);
  }
  if (meta.length > 0) lines.push('');

  if (p.contributions.length > 0) {
    lines.push('**Contributions:**');
    lines.push('');
    for (const c of p.contributions) {
      lines.push(`- ${c}`);
    }
    lines.push('');
  }

  if (p.speaking_segments.length > 0) {
    lines.push(`**Speaking segments:** ${p.speaking_segments.join(', ')}`);
    lines.push('');
  }

  if (p.contact_info.length > 0) {
    lines.push('**Contact:**');
    lines.push('');
    for (const ci of p.contact_info) {
      lines.push(`- ${ci}`);
    }
    lines.push('');
  }

  return lines;
}

export function writePeople(params: WritePeopleParams): string | null {
  const { peopleExtraction, speakerMapping } = params;
  if (peopleExtraction == null) return null;
  if (peopleExtraction.participants.length === 0) return null;

  const sections: string[] = ['# Participants', ''];

  for (let i = 0; i < peopleExtraction.participants.length; i++) {
    const p = peopleExtraction.participants[i];
    if (p != null) {
      sections.push(...renderParticipant(p, i, speakerMapping));
    }
  }

  if (peopleExtraction.relationships.length > 0) {
    sections.push('## Relationships', '');
    for (const r of peopleExtraction.relationships) {
      sections.push(`- ${r}`);
    }
    sections.push('');
  }

  // Trim trailing blank lines
  while (sections[sections.length - 1] === '') sections.pop();

  return sections.join('\n');
}
