import type { Pass1Result, ReconciliationResult, CanonicalSpeaker } from '../types/index.js';

const SPEAKER_NAME_RE = /^(SPEAKER_\d+)\s*\((.+)\)$/;

/**
 * Extract the base SPEAKER_XX id and optional name from a label such as
 * "SPEAKER_00 (Alice)" → { base: "SPEAKER_00", name: "alice" }
 * "SPEAKER_01"         → { base: "SPEAKER_01", name: null }
 */
function parseLabel(label: string): { base: string; name: string | null } {
  const m = SPEAKER_NAME_RE.exec(label.trim());
  if (m) {
    return { base: m[1], name: m[2].toLowerCase() };
  }
  return { base: label.trim(), name: null };
}

/** Format a canonical label from a base id and optional original-casing name. */
function formatLabel(base: string, originalName: string | null): string {
  return originalName != null ? `${base} (${originalName})` : base;
}

export interface ReconcileSpeakersParams {
  pass1Results: (Pass1Result | null)[];
}

/**
 * Reconcile speakers across all segments.
 *
 * Algorithm:
 * 1. Collect all speaker_summary entries + transcript speaker labels per segment.
 * 2. Extract names from SPEAKER_XX (Name) patterns (case-insensitive match key).
 * 3. Group named speakers across segments by extracted name — same name → same person.
 * 4. Unnamed speakers are unique per segment (no cross-segment grouping).
 * 5. Assign canonical IDs sequentially (SPEAKER_00, SPEAKER_01, …) by first appearance.
 * 6. Return mapping from "segmentIndex:originalLabel" → canonicalLabel, plus canonical speaker list.
 */
export function reconcileSpeakers(params: ReconcileSpeakersParams): ReconciliationResult {
  const { pass1Results } = params;

  // name (lowercase) → { canonicalIndex, originalName (first seen casing), descriptions[] }
  const namedGroups = new Map<
    string,
    { canonicalIndex: number; originalName: string; descriptions: string[] }
  >();

  // key "segmentIndex:originalLabel" for unnamed speakers →
  // { canonicalIndex, descriptions[] }
  const unnamedGroups = new Map<
    string,
    { canonicalIndex: number; descriptions: string[] }
  >();

  // Ordered list tracking assignment order for final output
  let nextCanonicalIndex = 0;

  // mapping from "segmentIndex:originalLabel" → canonicalIndex
  const rawMapping = new Map<string, number>();

  function getOrAssignNamed(
    name: string,
    originalName: string,
    description: string,
  ): number {
    const existing = namedGroups.get(name);
    if (existing) {
      if (description) existing.descriptions.push(description);
      return existing.canonicalIndex;
    }
    const idx = nextCanonicalIndex++;
    namedGroups.set(name, {
      canonicalIndex: idx,
      originalName,
      descriptions: description ? [description] : [],
    });
    return idx;
  }

  function getOrAssignUnnamed(
    segmentKey: string,
    description: string,
  ): number {
    const existing = unnamedGroups.get(segmentKey);
    if (existing) {
      if (description) existing.descriptions.push(description);
      return existing.canonicalIndex;
    }
    const idx = nextCanonicalIndex++;
    unnamedGroups.set(segmentKey, {
      canonicalIndex: idx,
      descriptions: description ? [description] : [],
    });
    return idx;
  }

  // Collect all unique labels per segment (from speaker_summary + transcript_entries)
  for (let segIdx = 0; segIdx < pass1Results.length; segIdx++) {
    const result = pass1Results[segIdx];
    if (result == null) continue;

    // Gather all labels mentioned in this segment
    const labelsInSegment = new Set<string>();
    for (const entry of result.speaker_summary ?? []) {
      if (entry.speaker_id) labelsInSegment.add(entry.speaker_id);
    }
    for (const entry of result.transcript_entries ?? []) {
      if (entry.speaker) labelsInSegment.add(entry.speaker);
    }

    // Build a description lookup from speaker_summary
    const descriptionByLabel = new Map<string, string>();
    for (const entry of result.speaker_summary ?? []) {
      if (entry.speaker_id) {
        descriptionByLabel.set(entry.speaker_id, entry.description ?? '');
      }
    }

    for (const label of labelsInSegment) {
      const mapKey = `${segIdx}:${label}`;
      if (rawMapping.has(mapKey)) continue; // already processed

      const { name } = parseLabel(label);
      const description = descriptionByLabel.get(label) ?? '';

      let canonicalIdx: number;
      if (name != null) {
        canonicalIdx = getOrAssignNamed(name, /* originalName */ parseOriginalName(label), description);
      } else {
        canonicalIdx = getOrAssignUnnamed(mapKey, description);
      }

      rawMapping.set(mapKey, canonicalIdx);
    }
  }

  // If nothing was found, return empty result
  if (rawMapping.size === 0) {
    return { mapping: {}, canonicalSpeakers: [] };
  }

  // Build ordered canonical speakers array
  // Slot count = nextCanonicalIndex
  const slots: Array<{ originalName: string | null; descriptions: string[] }> = Array.from(
    { length: nextCanonicalIndex },
    () => ({ originalName: null, descriptions: [] }),
  );

  for (const [, group] of namedGroups) {
    slots[group.canonicalIndex] = {
      originalName: group.originalName,
      descriptions: group.descriptions,
    };
  }
  for (const [, group] of unnamedGroups) {
    slots[group.canonicalIndex] = {
      originalName: null,
      descriptions: group.descriptions,
    };
  }

  const canonicalSpeakers: CanonicalSpeaker[] = slots.map((slot, idx) => ({
    label: formatLabel(formatCanonicalBase(idx), slot.originalName),
    descriptions: slot.descriptions,
  }));

  // Build string mapping from "segIdx:originalLabel" → canonical label
  const mapping: Record<string, string> = {};
  for (const [mapKey, canonicalIdx] of rawMapping) {
    mapping[mapKey] = canonicalSpeakers[canonicalIdx].label;
  }

  return { mapping, canonicalSpeakers };
}

/** Extract the original-casing name portion from a label like "SPEAKER_00 (Alice)". */
function parseOriginalName(label: string): string {
  const m = SPEAKER_NAME_RE.exec(label.trim());
  return m ? m[2] : label.trim();
}

/** Format the sequential canonical SPEAKER_XX id. */
function formatCanonicalBase(index: number): string {
  return `SPEAKER_${String(index).padStart(2, '0')}`;
}
