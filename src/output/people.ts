import type { PeopleExtraction, Participant, SpeakerMapping } from '../types/index.js';
import { applySpeakerMapping } from '../lib/utils.js';

export interface WritePeopleParams {
  peopleExtraction: PeopleExtraction | null | undefined;
  speakerMapping?: SpeakerMapping;
  declinedMerges?: [string, string][];
}

function renderParticipant(p: Participant, index: number): string[] {
  const lines: string[] = [];
  lines.push(`## ${index + 1}. ${p.name}`);
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

/** Returns true if the original name looks like a SPEAKER_XX identifier. */
function isSpeakerLabel(name: string): boolean {
  return /^SPEAKER_\d+$/.test(name);
}

/** Returns true if the pair [a, b] appears in declinedMerges (either ordering). */
function isPairDeclined(a: string, b: string, declinedMerges: [string, string][]): boolean {
  return declinedMerges.some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a),
  );
}

/** Merge an array of participants (all mapping to same name) into one. */
function mergeParticipants(mapped_name: string, group: Participant[]): Participant {
  const contributions: string[] = [];
  const seenContributions = new Set<string>();
  const speaking_segments: string[] = [];
  const seenSegments = new Set<string>();
  const contact_info: string[] = [];
  const seenContactInfo = new Set<string>();
  let role = '';
  let organization = '';

  for (const p of group) {
    for (const c of p.contributions) {
      if (!seenContributions.has(c)) {
        seenContributions.add(c);
        contributions.push(c);
      }
    }
    for (const s of p.speaking_segments) {
      if (!seenSegments.has(s)) {
        seenSegments.add(s);
        speaking_segments.push(s);
      }
    }
    for (const ci of p.contact_info) {
      if (!seenContactInfo.has(ci)) {
        seenContactInfo.add(ci);
        contact_info.push(ci);
      }
    }
    if (p.role.length > role.length) role = p.role;
    if (p.organization.length > organization.length) organization = p.organization;
  }

  return { name: mapped_name, role, organization, speaking_segments, contact_info, contributions };
}

/**
 * Resolve participants to render, applying deduplication for SPEAKER_XX labels
 * that map to the same name, unless the pair was explicitly declined.
 */
function resolveParticipants(
  participants: Participant[],
  speakerMapping: SpeakerMapping | undefined,
  declinedMerges: [string, string][],
): Participant[] {
  if (!speakerMapping || participants.length === 0) {
    // No mapping: just apply name display (no merge possible)
    return participants.map((p) => ({ ...p, name: applySpeakerMapping(p.name, speakerMapping) }));
  }

  // Group participants by their mapped name, but only for SPEAKER_XX-labelled ones
  // that appear as keys in the speakerMapping.
  const speakerGroups = new Map<string, Participant[]>();
  const nonMergeable: Participant[] = [];

  for (const p of participants) {
    if (isSpeakerLabel(p.name) && speakerMapping[p.name] != null) {
      const mappedName = speakerMapping[p.name];
      if (!speakerGroups.has(mappedName)) speakerGroups.set(mappedName, []);
      speakerGroups.get(mappedName)!.push(p);
    } else {
      // Not a SPEAKER_XX key — apply mapping for display but don't merge
      nonMergeable.push({ ...p, name: applySpeakerMapping(p.name, speakerMapping) });
    }
  }

  const result: Participant[] = [];

  for (const [mappedName, group] of speakerGroups) {
    if (group.length === 1) {
      // Solo — no merge needed
      result.push({ ...group[0], name: mappedName });
    } else {
      // Multiple SPEAKER_XX labels mapped to the same name.
      // Check if ANY pair in the group was declined.
      const originalNames = group.map((p) => p.name);
      let anyDeclined = false;
      outer: for (let i = 0; i < originalNames.length; i++) {
        for (let j = i + 1; j < originalNames.length; j++) {
          if (isPairDeclined(originalNames[i]!, originalNames[j]!, declinedMerges)) {
            anyDeclined = true;
            break outer;
          }
        }
      }

      if (anyDeclined) {
        // Keep as separate entries, but apply the mapped name to each
        for (const p of group) {
          result.push({ ...p, name: mappedName });
        }
      } else {
        // Merge all into one
        result.push(mergeParticipants(mappedName, group));
      }
    }
  }

  // Append non-mergeable participants after the merged ones (preserve original order among them)
  result.push(...nonMergeable);

  return result;
}

export function writePeople(params: WritePeopleParams): string | null {
  const { peopleExtraction, speakerMapping, declinedMerges = [] } = params;
  if (peopleExtraction == null) return null;
  if (peopleExtraction.participants.length === 0) return null;

  const participants = resolveParticipants(
    peopleExtraction.participants,
    speakerMapping,
    declinedMerges,
  );

  if (participants.length === 0) return null;

  const sections: string[] = ['# Participants', ''];

  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    if (p != null) {
      sections.push(...renderParticipant(p, i));
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
