import { readFile } from 'fs/promises';
import { join } from 'path';
import { log, text, isCancel, cancel } from '@clack/prompts';
import type { Pass1Result, PeopleExtraction, SpeakerMapping } from '../types/index.js';
import type { MetadataOutput } from '../output/metadata.js';
import { reRenderWithSpeakerMapping } from '../output/generator.js';

/**
 * Read a JSON file from disk, returning null on any error.
 */
async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Collect all unique speaker labels from pass1-seg*.json files in the raw/ directory.
 * Returns labels sorted by total transcript entry count descending, then label ascending.
 */
async function collectSpeakersFromRaw(
  rawDir: string,
): Promise<{ label: string; entryCount: number }[]> {
  const speakerEntries = new Map<string, number>();

  for (let n = 0; n < 1000; n++) {
    const pass1 = await readJson<Pass1Result>(join(rawDir, `pass1-seg${n}.json`));
    if (pass1 == null) break;

    for (const info of pass1.speaker_summary) {
      if (!info.speaker_id) continue;
      const existing = speakerEntries.get(info.speaker_id) ?? 0;
      const count = pass1.transcript_entries.filter((e) => e.speaker === info.speaker_id).length;
      speakerEntries.set(info.speaker_id, existing + count);
    }
  }

  const result = Array.from(speakerEntries.entries()).map(([label, entryCount]) => ({
    label,
    entryCount,
  }));

  result.sort((a, b) => {
    if (b.entryCount !== a.entryCount) return b.entryCount - a.entryCount;
    return a.label.localeCompare(b.label);
  });

  return result;
}

export async function run(args: string[]): Promise<void> {
  const outputDir = args[0];

  if (outputDir == null || outputDir.trim() === '') {
    log.error('Usage: vidistill rename-speakers <output-dir>');
    return;
  }

  // Read metadata.json
  const metadataPath = join(outputDir, 'metadata.json');
  const metadata = await readJson<MetadataOutput>(metadataPath);

  if (metadata == null) {
    log.error('Not a vidistill output directory');
    return;
  }

  // Check for people extraction data
  const rawDir = join(outputDir, 'raw');
  const peopleExtraction = await readJson<PeopleExtraction>(join(rawDir, 'pass3b-people.json'));

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

  const newMapping: SpeakerMapping = { ...existingMapping };

  for (const { label } of speakers) {
    const currentName = existingMapping[label] ?? label;

    const value = await text({
      message: `Name for ${label}`,
      placeholder: 'Enter name or press Enter to keep current',
      defaultValue: currentName,
    });

    if (isCancel(value)) {
      cancel('Speaker naming cancelled.');
      return;
    }

    const trimmed = (value as string).trim();
    if (trimmed.length > 0 && trimmed !== label) {
      newMapping[label] = trimmed;
    } else if (trimmed === label || trimmed === '') {
      // User cleared back to label — remove mapping if it existed
      delete newMapping[label];
    }
  }

  log.info('Re-rendering output files with updated speaker names...');

  const result = await reRenderWithSpeakerMapping({ outputDir, speakerMapping: newMapping });

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      log.error(err);
    }
  }

  log.info(`Done. ${String(result.filesGenerated.length)} file${result.filesGenerated.length === 1 ? '' : 's'} updated.`);
}
