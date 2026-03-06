export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [
    String(h).padStart(2, '0'),
    String(m).padStart(2, '0'),
    String(s).padStart(2, '0'),
  ].join(':');
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function parseTimestamp(ts: string): number {
  const parts = ts.trim().split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0);
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return (m ?? 0) * 60 + (s ?? 0);
  }
  return parts[0] ?? 0;
}

/**
 * Normalize a filename for comparison:
 * - lowercase
 * - strip leading ./
 * - unify path separators to forward slashes
 */
export function normalizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/^\.\//, '')
    .replace(/\\/g, '/');
}

export function applySpeakerMapping(label: string, mapping?: Record<string, string>): string {
  if (!mapping) return label;
  // Direct match
  if (mapping[label] != null) return mapping[label];
  // Extract SPEAKER_XX prefix from "SPEAKER_XX (description)" format
  const speakerMatch = label.match(/^(SPEAKER_\d+)\s*\(/);
  if (speakerMatch && mapping[speakerMatch[1]] != null) return mapping[speakerMatch[1]];
  // Strip parenthetical suffix: "K Iphone (Chris)" → try "K Iphone"
  const parenMatch = label.match(/^(.+?)\s*\(.*\)$/);
  if (parenMatch) {
    const stripped = parenMatch[1].trim();
    if (mapping[stripped] != null) return mapping[stripped];
  }
  // Case-insensitive fallback
  const lower = label.toLowerCase();
  for (const [key, value] of Object.entries(mapping)) {
    if (key.toLowerCase() === lower) return value;
  }
  return label;
}

import type { SegmentResult, SpeakerMapping, PeopleExtraction } from '../types/index.js';
import { readFile } from 'fs/promises';

/**
 * Replace all known speaker name variants in free text.
 * Uses the expanded mapping to find and replace names, processing
 * longest keys first to avoid partial matches (e.g. "Professor Eugene Callahan"
 * before "Eugene Callahan"). Skips SPEAKER_XX labels since those don't appear
 * in prose text.
 */
export function replaceNamesInText(text: string, mapping?: SpeakerMapping): string {
  if (!mapping || text.length === 0) return text;

  // Only replace entries where key !== value and key isn't a SPEAKER_XX label
  const entries = Object.entries(mapping)
    .filter(([key, value]) => key !== value && !/^SPEAKER_\d+$/.test(key))
    .sort((a, b) => b[0].length - a[0].length); // longest first

  if (entries.length === 0) return text;

  // Use placeholder tokens to prevent cascade replacements
  // (e.g., replacing "Stephen" → "Steven Kang" in "Stephen Kang" producing "Steven Kang Kang")
  let result = text;
  const placeholders = new Map<string, string>();
  let idx = 0;

  for (const [key, value] of entries) {
    const placeholder = `\x00PH${idx}\x00`;
    placeholders.set(placeholder, value);
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'g');
    result = result.replace(re, placeholder);
    idx++;
  }

  for (const [placeholder, value] of placeholders) {
    result = result.replaceAll(placeholder, value);
  }

  return result;
}

/**
 * Build an expanded speaker mapping that includes detected-name keys
 * in addition to SPEAKER_XX keys from the user's mapping.
 *
 * Cross-references speaker_summary descriptions and transcript entry
 * speaker fields to map Gemini-detected names to user-assigned names.
 */
export function buildExpandedMapping(
  segments: SegmentResult[],
  speakerMapping: SpeakerMapping,
  peopleExtraction?: PeopleExtraction | null,
): SpeakerMapping {
  const expanded: SpeakerMapping = { ...speakerMapping };

  for (const seg of segments) {
    if (seg.pass1 == null) continue;

    for (const info of seg.pass1.speaker_summary) {
      const userAssigned = speakerMapping[info.speaker_id];
      if (!userAssigned || !info.description) continue;

      // Extract name from description (before first comma)
      const descName = info.description.split(',')[0].trim();
      if (!descName) continue;

      // Handle alt names in parens: "Haoxuan Wang (Mike)" → map both
      const altMatch = descName.match(/^(.+?)\s*\((.+?)\)$/);
      if (altMatch) {
        const mainName = altMatch[1].trim();
        const altName = altMatch[2].trim();
        if (mainName !== userAssigned) expanded[mainName] = userAssigned;
        if (altName !== userAssigned) expanded[altName] = userAssigned;
      } else if (descName !== userAssigned) {
        expanded[descName] = userAssigned;
      }
    }

    // Extract names from transcript entry speaker fields: "SPEAKER_XX (Name)"
    for (const entry of seg.pass1.transcript_entries) {
      const match = entry.speaker.match(/^(SPEAKER_\d+)\s*\((.+?)\)$/);
      if (match) {
        const userAssigned = speakerMapping[match[1]];
        if (userAssigned && match[2] !== userAssigned) {
          expanded[match[2]] = userAssigned;
        }
      }
    }
  }

  // Cross-reference people extraction participant names with expanded mapping keys.
  // If a participant name (e.g., "Stephen Kang") contains an existing key (e.g., "Stephen")
  // that maps to a different name, add the full participant name as a key too.
  if (peopleExtraction?.participants != null) {
    for (const p of peopleExtraction.participants) {
      if (!p.name || expanded[p.name] != null) continue;
      // Check if any existing non-SPEAKER key is a substring of this participant name
      for (const [key, value] of Object.entries(expanded)) {
        if (/^SPEAKER_\d+$/.test(key)) continue;
        if (key === value) continue;
        if (p.name !== key && p.name.includes(key)) {
          expanded[p.name] = value;
          break;
        }
      }
    }
  }

  return expanded;
}

/**
 * Read a JSON file from disk, returning null on any error (missing file, corrupt JSON).
 * Validates that the parsed result is a non-null object before returning.
 */
export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed == null) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

export function changeTypeBadge(changeType: string): string {
  const badges: Record<string, string> = {
    new_file: '[NEW]',
    addition: '[ADD]',
    modification: '[MOD]',
    deletion: '[DEL]',
    unchanged: '[---]',
    scroll: '[SCR]',
  };
  return badges[changeType] || `[${changeType.toUpperCase()}]`;
}
