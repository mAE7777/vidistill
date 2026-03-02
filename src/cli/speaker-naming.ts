import { log, text, confirm, isCancel, cancel } from '@clack/prompts';
import type { PipelineResult, SpeakerMapping, Participant } from '../types/index.js';

export interface SpeakerContext {
  /** Canonical SPEAKER_XX label from Pass 1 speaker_summary */
  label: string;
  /** Human-readable description from PeopleExtraction, or empty string */
  description: string;
  /** Approximate speaking time in seconds, used for sorting */
  speakingSeconds: number;
}

/**
 * Build a list of speaker contexts from pipeline result data.
 * Uses speaker_summary from Pass 1 as the canonical source of speaker labels.
 * Participant descriptions from PeopleExtraction are cross-referenced by name.
 *
 * Returns speakers sorted by speaking time descending.
 */
export function buildSpeakerContext(pipelineResult: PipelineResult): SpeakerContext[] {
  const { segments, peopleExtraction } = pipelineResult;

  // Collect all unique speaker labels from pass1 speaker_summary across all segments
  const speakerMap = new Map<string, { totalEntries: number; descriptions: string[] }>();

  for (const seg of segments) {
    if (seg.pass1 == null) continue;
    for (const info of seg.pass1.speaker_summary) {
      if (!info.speaker_id) continue;
      const existing = speakerMap.get(info.speaker_id);
      if (existing == null) {
        speakerMap.set(info.speaker_id, { totalEntries: 0, descriptions: [] });
      }
      const entry = speakerMap.get(info.speaker_id)!;
      // Count transcript entries for this speaker as a proxy for speaking time
      const entryCount = seg.pass1.transcript_entries.filter(
        (e) => e.speaker === info.speaker_id,
      ).length;
      entry.totalEntries += entryCount;
      if (info.description && info.description.trim().length > 0) {
        entry.descriptions.push(info.description.trim());
      }
    }
  }

  // Build participants lookup from PeopleExtraction by normalized speaker-like name
  const participantsByLabel = new Map<string, Participant>();
  if (peopleExtraction?.participants != null) {
    for (const p of peopleExtraction.participants) {
      // Match "SPEAKER_00" style names in participant.name
      if (/^SPEAKER_\d+$/.test(p.name)) {
        participantsByLabel.set(p.name, p);
      }
    }
  }

  const contexts: SpeakerContext[] = [];

  for (const [label, data] of speakerMap.entries()) {
    // Prefer participant contributions as description, fall back to speaker_summary description
    const participant = participantsByLabel.get(label);
    let description = '';
    if (participant != null) {
      if (participant.contributions.length > 0) {
        description = participant.contributions[0];
      } else if (participant.role) {
        description = participant.role;
      }
    }
    if (!description && data.descriptions.length > 0) {
      description = data.descriptions[0];
    }

    contexts.push({
      label,
      description,
      speakingSeconds: data.totalEntries, // Using entry count as proxy
    });
  }

  // Sort by speaking time descending, then label ascending for ties
  contexts.sort((a, b) => {
    if (b.speakingSeconds !== a.speakingSeconds) return b.speakingSeconds - a.speakingSeconds;
    return a.label.localeCompare(b.label);
  });

  return contexts;
}

/**
 * Detect duplicate names in a speaker mapping and prompt the user to confirm or decline
 * merging each group of duplicates.
 *
 * For each group of SPEAKER_XX labels sharing the same name:
 *   - The first label (sorted ascending) is the "primary"
 *   - Each subsequent label is prompted for merge into the primary
 *
 * Returns the (possibly modified) mapping and a list of declined merge pairs.
 * Returns null if the user cancels during any merge prompt.
 */
export async function detectAndPromptMerges(
  mapping: SpeakerMapping,
): Promise<{ mapping: SpeakerMapping; declinedMerges: [string, string][] } | null> {
  // Group labels by their assigned name
  const byName = new Map<string, string[]>();
  for (const [label, name] of Object.entries(mapping)) {
    const existing = byName.get(name);
    if (existing == null) {
      byName.set(name, [label]);
    } else {
      existing.push(label);
    }
  }

  const declinedMerges: [string, string][] = [];
  const resultMapping: SpeakerMapping = { ...mapping };

  for (const [name, labels] of byName.entries()) {
    if (labels.length < 2) continue;

    // Sort labels so the primary is the first in ascending order
    const sorted = [...labels].sort((a, b) => a.localeCompare(b));
    const primary = sorted[0];
    const secondaries = sorted.slice(1);

    for (const secondary of secondaries) {
      const answer = await confirm({
        message: `You assigned '${name}' to both ${primary} and ${secondary}. Merge ${secondary} into ${primary} (${name})?`,
      });

      if (isCancel(answer)) {
        cancel('Speaker naming cancelled.');
        return null;
      }

      if (answer === true) {
        // Merge: secondary now maps to name via the primary — both map to same name (already the case)
        // No structural change needed since both already map to the same name;
        // the merge is recorded by keeping both in the mapping pointing to the same name.
        // No action required on resultMapping — they already both map to name.
      } else {
        // Declined: record the pair
        declinedMerges.push([primary, secondary]);
      }
    }
  }

  return { mapping: resultMapping, declinedMerges };
}

/**
 * Prompt the user to name the given speakers.
 * Returns a partial mapping (only speakers given a non-empty name).
 * Returns null if the user cancels at any point.
 */
async function promptForSpeakers(speakers: SpeakerContext[]): Promise<SpeakerMapping | null> {
  const mapping: SpeakerMapping = {};

  for (const speaker of speakers) {
    const descPart = speaker.description ? ` — ${speaker.description}` : '';
    const value = await text({
      message: `Name for ${speaker.label}${descPart} [${speaker.speakingSeconds} entries]:`,
      placeholder: 'Enter name or press Enter to skip',
    });

    if (isCancel(value)) {
      cancel('Speaker naming cancelled.');
      return null;
    }

    const trimmed = (value as string).trim();
    if (trimmed.length > 0) {
      mapping[speaker.label] = trimmed;
    }
  }

  return mapping;
}

/**
 * Run the full speaker naming prompt flow.
 *
 * - If ≤1 speaker detected: returns null (no prompt shown).
 * - All speakers are shown sequentially with no split or confirmation gate.
 * - After naming, detects duplicate name assignments and prompts for merge confirmation.
 *
 * Returns null if cancelled or no speakers to name.
 * Returns an empty object {} if user provides no names (all skipped).
 * Wraps everything in try/catch — non-TTY environments silently return null.
 */
export async function promptSpeakerNames(
  pipelineResult: PipelineResult,
): Promise<{ mapping: SpeakerMapping; declinedMerges: [string, string][] } | null> {
  try {
    const allSpeakers = buildSpeakerContext(pipelineResult);

    // No prompt for 0 or 1 speaker
    if (allSpeakers.length <= 1) {
      return null;
    }

    log.info(`${String(allSpeakers.length)} speakers detected. Enter names to personalize output (or press Enter to skip each).`);

    const mapping = await promptForSpeakers(allSpeakers);
    if (mapping == null) return null;

    const mergeResult = await detectAndPromptMerges(mapping);
    if (mergeResult == null) return null;

    return mergeResult;
  } catch {
    // Non-TTY or other errors — skip silently
    return null;
  }
}
