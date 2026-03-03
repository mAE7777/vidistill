import { join } from 'path';
import { log, text, isCancel, cancel } from '@clack/prompts';
import type { Pass1Result, PeopleExtraction, SpeakerMapping } from '../types/index.js';
import type { MetadataOutput } from '../output/metadata.js';
import { reRenderWithSpeakerMapping } from '../output/generator.js';
import { readJsonFile } from '../lib/utils.js';
import { detectAndPromptMerges } from '../cli/speaker-naming.js';

/**
 * Collect all unique speaker labels from pass1-seg*.json files in the raw/ directory.
 * Returns labels sorted by total transcript entry count descending, then label ascending.
 */
async function collectSpeakersFromRaw(
  rawDir: string,
): Promise<{ label: string; entryCount: number; description: string }[]> {
  const speakerEntries = new Map<string, { count: number; description: string }>();

  for (let n = 0; n < 1000; n++) {
    const pass1 = await readJsonFile<Pass1Result>(join(rawDir, `pass1-seg${n}.json`));
    if (pass1 == null) break;

    for (const info of pass1.speaker_summary) {
      if (!info.speaker_id) continue;
      const existing = speakerEntries.get(info.speaker_id);
      const count = pass1.transcript_entries.filter((e) => e.speaker === info.speaker_id).length;
      if (existing == null) {
        const description = info.description?.trim() ?? '';
        speakerEntries.set(info.speaker_id, { count, description });
      } else {
        existing.count += count;
        if (!existing.description && info.description?.trim()) {
          existing.description = info.description.trim();
        }
      }
    }
  }

  const result = Array.from(speakerEntries.entries()).map(([label, { count, description }]) => ({
    label,
    entryCount: count,
    description,
  }));

  result.sort((a, b) => {
    if (b.entryCount !== a.entryCount) return b.entryCount - a.entryCount;
    return a.label.localeCompare(b.label);
  });

  return result;
}

/**
 * Group speaker labels by their currently mapped name (for re-display when already merged).
 * Returns groups: each group has a representative name (or null for unmapped), member labels,
 * and the combined entry count.
 */
function groupSpeakersByExistingMapping(
  speakers: { label: string; entryCount: number; description: string }[],
  existingMapping: SpeakerMapping,
): {
  name: string | null;
  labels: string[];
  totalEntries: number;
  description: string;
}[] {
  // Build reverse map: name -> labels
  const byName = new Map<string, string[]>();
  const unmapped: string[] = [];

  for (const { label } of speakers) {
    const name = existingMapping[label];
    if (name != null) {
      const existing = byName.get(name);
      if (existing == null) {
        byName.set(name, [label]);
      } else {
        existing.push(label);
      }
    } else {
      unmapped.push(label);
    }
  }

  const groups: { name: string | null; labels: string[]; totalEntries: number; description: string }[] = [];

  // Add named groups (each group represents speakers merged under same name)
  for (const [name, labels] of byName.entries()) {
    const totalEntries = labels.reduce((sum, lbl) => {
      const s = speakers.find((sp) => sp.label === lbl);
      return sum + (s?.entryCount ?? 0);
    }, 0);
    // Use description from the first label (primary)
    const sortedLabels = [...labels].sort((a, b) => a.localeCompare(b));
    const primarySpeaker = speakers.find((sp) => sp.label === sortedLabels[0]);
    groups.push({ name, labels: sortedLabels, totalEntries, description: primarySpeaker?.description ?? '' });
  }

  // Add unmapped speakers as individual entries
  for (const label of unmapped) {
    const sp = speakers.find((s) => s.label === label)!;
    groups.push({ name: null, labels: [label], totalEntries: sp.entryCount, description: sp.description });
  }

  // Sort groups by total entry count descending, then primary label ascending for ties
  groups.sort((a, b) => {
    if (b.totalEntries !== a.totalEntries) return b.totalEntries - a.totalEntries;
    return (a.labels[0] ?? '').localeCompare(b.labels[0] ?? '');
  });

  return groups;
}

/**
 * Parse flags from args[].
 * Returns: { outputDir, list, rename: [old, new] | null, merge: [source, target] | null }
 */
function parseArgs(args: string[]): {
  outputDir: string | null;
  list: boolean;
  rename: [string, string] | null;
  merge: [string, string] | null;
  error: string | null;
} {
  let outputDir: string | null = null;
  let list = false;
  let rename: [string, string] | null = null;
  let merge: [string, string] | null = null;

  // Track which indices are consumed as flag values
  const consumed = new Set<number>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--list') {
      list = true;
      consumed.add(i);
    } else if (arg === '--rename') {
      const a = args[i + 1];
      const b = args[i + 2];
      if (a == null || b == null) {
        return { outputDir: null, list: false, rename: null, merge: null, error: '--rename requires two arguments: --rename "old name" "new name"' };
      }
      if (a.startsWith('--') || b.startsWith('--')) {
        return { outputDir: null, list: false, rename: null, merge: null, error: '--rename requires two arguments: --rename "old name" "new name"' };
      }
      rename = [a, b];
      consumed.add(i);
      consumed.add(i + 1);
      consumed.add(i + 2);
      i += 2;
    } else if (arg === '--merge') {
      const a = args[i + 1];
      const b = args[i + 2];
      if (a == null || b == null) {
        return { outputDir: null, list: false, rename: null, merge: null, error: '--merge requires two arguments: --merge "source" "target"' };
      }
      if (a.startsWith('--') || b.startsWith('--')) {
        return { outputDir: null, list: false, rename: null, merge: null, error: '--merge requires two arguments: --merge "source" "target"' };
      }
      merge = [a, b];
      consumed.add(i);
      consumed.add(i + 1);
      consumed.add(i + 2);
      i += 2;
    }
  }

  // outputDir: first non-consumed arg that doesn't start with '--'
  for (let i = 0; i < args.length; i++) {
    if (!consumed.has(i) && !args[i].startsWith('--')) {
      outputDir = args[i];
      break;
    }
  }

  return { outputDir, list, rename, merge, error: null };
}

/**
 * Format a list of names for an error message (comma-separated, quoted).
 */
function formatNameList(names: string[]): string {
  return names.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(', ');
}

/**
 * --list flow: display numbered list of speakers with entry counts.
 */
async function runList(outputDir: string): Promise<void> {
  const metadataPath = join(outputDir, 'metadata.json');
  const metadata = await readJsonFile<MetadataOutput>(metadataPath);

  if (metadata == null) {
    log.error('Not a vidistill output directory');
    return;
  }

  const rawDir = join(outputDir, 'raw');
  const speakers = await collectSpeakersFromRaw(rawDir);
  const speakerMapping: SpeakerMapping = metadata.speakerMapping ?? {};

  if (speakers.length === 0 && Object.keys(speakerMapping).length === 0) {
    log.info('No speakers found.');
    return;
  }

  // Build display list grouped by name (same logic as interactive flow)
  const groups = groupSpeakersByExistingMapping(speakers, speakerMapping);

  if (groups.length === 0) {
    log.info('No speakers found.');
    return;
  }

  const lines = groups.map((group, idx) => {
    const num = idx + 1;
    const displayName = group.name ?? group.labels[0]!;
    const labelsStr = group.labels.join(', ');
    return `${String(num)}. ${displayName} (${labelsStr}, ${String(group.totalEntries)} entries)`;
  });

  log.info(lines.join('\n'));
}

/**
 * --rename "old" "new" flow.
 */
async function runRename(outputDir: string, oldName: string, newName: string): Promise<void> {
  if (newName.trim().length === 0) {
    log.error('New name cannot be empty. Use the interactive prompt to clear a mapping.');
    return;
  }

  const metadataPath = join(outputDir, 'metadata.json');
  const metadata = await readJsonFile<MetadataOutput>(metadataPath);

  if (metadata == null) {
    log.error('Not a vidistill output directory');
    return;
  }

  const speakerMapping: SpeakerMapping = { ...(metadata.speakerMapping ?? {}) };
  const rawDir = join(outputDir, 'raw');
  const speakers = await collectSpeakersFromRaw(rawDir);

  // Find matching keys: either value matches oldName, or the key itself is oldName (SPEAKER_XX direct)
  const matchingKeys: string[] = [];

  // Check if oldName is a SPEAKER_XX label directly
  const directKey = speakers.find((s) => s.label === oldName);
  if (directKey != null) {
    matchingKeys.push(directKey.label);
  } else {
    // Search by mapped name value
    for (const [key, value] of Object.entries(speakerMapping)) {
      if (value === oldName) {
        matchingKeys.push(key);
      }
    }
  }

  if (matchingKeys.length === 0) {
    const currentNames = Object.values(speakerMapping);
    const unmappedLabels = speakers.filter((s) => speakerMapping[s.label] == null).map((s) => s.label);
    const allNames = [...new Set([...currentNames, ...unmappedLabels])];
    log.error(`No speaker named "${oldName}" found. Current speakers: ${formatNameList(allNames)}`);
    return;
  }

  if (matchingKeys.length > 1) {
    log.error(
      `Multiple speakers named "${oldName}" (${matchingKeys.join(', ')}). Use SPEAKER_XX label to specify which one.`,
    );
    return;
  }

  // Exactly one match — update mapping
  const key = matchingKeys[0]!;
  speakerMapping[key] = newName;

  log.info('Re-rendering output files with updated speaker names...');

  const result = await reRenderWithSpeakerMapping({
    outputDir,
    speakerMapping,
    declinedMerges: metadata.declinedMerges,
  });

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      log.error(err);
    }
  }

  log.info(`Done. ${String(result.filesGenerated.length)} file${result.filesGenerated.length === 1 ? '' : 's'} updated.`);
}

/**
 * --merge "source" "target" flow.
 */
async function runMerge(outputDir: string, sourceName: string, targetName: string): Promise<void> {
  const metadataPath = join(outputDir, 'metadata.json');
  const metadata = await readJsonFile<MetadataOutput>(metadataPath);

  if (metadata == null) {
    log.error('Not a vidistill output directory');
    return;
  }

  const speakerMapping: SpeakerMapping = { ...(metadata.speakerMapping ?? {}) };
  const rawDir = join(outputDir, 'raw');
  const speakers = await collectSpeakersFromRaw(rawDir);

  // Build a helper to find all keys for a given name or SPEAKER_XX label
  function findKeys(name: string): string[] {
    // Check if name is a SPEAKER_XX label directly
    const directKey = speakers.find((s) => s.label === name);
    if (directKey != null) {
      return [directKey.label];
    }
    // Search by mapped name value
    const keys: string[] = [];
    for (const [key, value] of Object.entries(speakerMapping)) {
      if (value === name) {
        keys.push(key);
      }
    }
    // Also look for unmapped speaker whose label might be their display name (no mapping set)
    if (keys.length === 0) {
      // Check unmapped speakers: their effective name is their label
      const unmapped = speakers.filter((s) => speakerMapping[s.label] == null && s.label === name);
      for (const s of unmapped) {
        keys.push(s.label);
      }
    }
    return keys;
  }

  const sourceKeys = findKeys(sourceName);
  const targetKeys = findKeys(targetName);

  if (sourceKeys.length === 0) {
    const currentNames = buildCurrentNames(speakers, speakerMapping);
    log.error(`No speaker named "${sourceName}" found. Current speakers: ${formatNameList(currentNames)}`);
    return;
  }

  if (targetKeys.length === 0) {
    const currentNames = buildCurrentNames(speakers, speakerMapping);
    log.error(`No speaker named "${targetName}" found. Current speakers: ${formatNameList(currentNames)}`);
    return;
  }

  // Determine the target's display name
  // If targetKeys[0] has a mapping, use that; otherwise use the targetName as provided
  const resolvedTargetName = speakerMapping[targetKeys[0]!] ?? targetName;

  // Merge: source key(s) now map to target name
  for (const key of sourceKeys) {
    speakerMapping[key] = resolvedTargetName;
  }

  log.info('Re-rendering output files with updated speaker names...');

  const result = await reRenderWithSpeakerMapping({
    outputDir,
    speakerMapping,
    declinedMerges: metadata.declinedMerges,
  });

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      log.error(err);
    }
  }

  log.info(`Done. ${String(result.filesGenerated.length)} file${result.filesGenerated.length === 1 ? '' : 's'} updated.`);
}

/**
 * Build a deduplicated list of current speaker names/labels for error messages.
 */
function buildCurrentNames(
  speakers: { label: string; entryCount: number; description: string }[],
  speakerMapping: SpeakerMapping,
): string[] {
  const names = new Set<string>();
  for (const value of Object.values(speakerMapping)) {
    names.add(value);
  }
  for (const s of speakers) {
    if (speakerMapping[s.label] == null) {
      names.add(s.label);
    }
  }
  return [...names];
}

export async function run(args: string[]): Promise<void> {
  const { outputDir, list, rename, merge, error } = parseArgs(args);

  if (error != null) {
    log.error(error);
    return;
  }

  if (outputDir == null || outputDir.trim() === '') {
    log.error('Usage: vidistill rename-speakers <output-dir> [--list] [--rename "old" "new"] [--merge "source" "target"]');
    return;
  }

  // --list flag
  if (list) {
    await runList(outputDir);
    return;
  }

  // --rename flag
  if (rename != null) {
    await runRename(outputDir, rename[0], rename[1]);
    return;
  }

  // --merge flag
  if (merge != null) {
    await runMerge(outputDir, merge[0], merge[1]);
    return;
  }

  // Interactive flow (existing)
  // Read metadata.json
  const metadataPath = join(outputDir, 'metadata.json');
  const metadata = await readJsonFile<MetadataOutput>(metadataPath);

  if (metadata == null) {
    log.error('Not a vidistill output directory');
    return;
  }

  // Check for people extraction data
  const rawDir = join(outputDir, 'raw');
  const peopleExtraction = await readJsonFile<PeopleExtraction>(join(rawDir, 'pass3b-people.json'));

  if (peopleExtraction == null) {
    log.info('No speakers detected in this video');
    return;
  }

  // Collect all unique speaker labels from pass1 segment files
  const speakers = await collectSpeakersFromRaw(rawDir);

  if (speakers.length === 0) {
    log.info('No speakers detected in this video');
    return;
  }

  // Load existing speaker mapping as defaults
  const existingMapping: SpeakerMapping = metadata.speakerMapping ?? {};

  log.info(
    `${String(speakers.length)} speaker${speakers.length === 1 ? '' : 's'} found. Enter names (or press Enter to keep current).`,
  );

  // Group speakers by existing mapping for merged display
  const groups = groupSpeakersByExistingMapping(speakers, existingMapping);

  const newMapping: SpeakerMapping = { ...existingMapping };

  for (const group of groups) {
    const { name: currentName, labels, totalEntries, description } = group;
    const isGrouped = labels.length > 1;

    let message: string;
    let defaultValue: string;

    if (isGrouped && currentName != null) {
      // Multiple labels merged under the same name — show combined prompt
      const labelsStr = labels.join(' + ');
      message = `Name for ${currentName} [${labelsStr}, ${totalEntries} entries]:`;
      defaultValue = currentName;
    } else if (currentName != null) {
      // Single label with existing mapping
      const label = labels[0]!;
      message = `Name for ${currentName} [${label}, ${totalEntries} entries]:`;
      defaultValue = currentName;
    } else {
      // Unmapped label
      const label = labels[0]!;
      const descPart = description ? ` — ${description}` : '';
      message = `Name for ${label}${descPart} [${totalEntries} entries]:`;
      defaultValue = label;
    }

    const value = await text({
      message,
      placeholder: 'Enter name or press Enter to keep current',
      defaultValue,
    });

    if (isCancel(value) || typeof value !== 'string') {
      cancel('Speaker naming cancelled.');
      return;
    }

    const trimmed = value.trim();

    for (const label of labels) {
      if (trimmed.length > 0 && trimmed !== label) {
        newMapping[label] = trimmed;
      } else if (trimmed === label || trimmed === '') {
        // User cleared back to label — remove mapping if it existed
        delete newMapping[label];
      }
    }
  }

  // Detect duplicate name assignments and prompt for merge confirmation
  const mergeResult = await detectAndPromptMerges(newMapping);
  if (mergeResult == null) {
    // User cancelled during merge prompt
    return;
  }

  const { mapping: finalMapping, declinedMerges } = mergeResult;

  log.info('Re-rendering output files with updated speaker names...');

  const result = await reRenderWithSpeakerMapping({
    outputDir,
    speakerMapping: finalMapping,
    declinedMerges: declinedMerges.length > 0 ? declinedMerges : undefined,
  });

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      log.error(err);
    }
  }

  log.info(`Done. ${String(result.filesGenerated.length)} file${result.filesGenerated.length === 1 ? '' : 's'} updated.`);
}
