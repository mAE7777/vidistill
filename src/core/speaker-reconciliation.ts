import type { Pass1Result, ReconciliationResult, CanonicalSpeaker } from '../types/index.js';
import { parseTimestamp } from '../lib/utils.js';

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

/** Compute Jaccard token overlap between two name strings. */
export function jaccardOverlap(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(t => t.length > 0));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(t => t.length > 0));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersectionCount = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersectionCount++;
  }
  const unionSize = tokensA.size + tokensB.size - intersectionCount;
  return intersectionCount / unionSize;
}

interface NamedGroup {
  canonicalIndex: number;
  originalName: string;
  descriptions: string[];
  /** Set of segment indices this group appears in */
  segmentIndices: Set<number>;
}

/** Check whether two named groups have any temporal overlap based on transcript entry timestamps. */
function speakersOverlapTemporally(
  groupAName: string,
  groupBName: string,
  namedGroups: Map<string, NamedGroup>,
  pass1Results: (Pass1Result | null)[],
): boolean {
  const groupA = namedGroups.get(groupAName);
  const groupB = namedGroups.get(groupBName);
  if (!groupA || !groupB) return false;

  // Collect timestamps (in seconds) for each group's entries
  const timestampsA = new Set<number>();
  const timestampsB = new Set<number>();

  for (let segIdx = 0; segIdx < pass1Results.length; segIdx++) {
    const result = pass1Results[segIdx];
    if (result == null) continue;

    for (const entry of result.transcript_entries ?? []) {
      const { name } = parseLabel(entry.speaker);
      if (name == null) continue;
      const secs = parseTimestamp(entry.timestamp);
      if (name === groupAName) {
        timestampsA.add(secs);
      } else if (name === groupBName) {
        timestampsB.add(secs);
      }
    }
  }

  // Check for any same-second collision
  for (const t of timestampsA) {
    if (timestampsB.has(t)) return true;
  }
  return false;
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
 * 5. Fuzzy merge: for pairs of unmerged named groups, compute Jaccard token overlap;
 *    if >= 0.5 and no temporal overlap, merge the smaller group into the larger.
 * 6. Assign canonical IDs sequentially (SPEAKER_00, SPEAKER_01, …) by first appearance.
 * 7. Return mapping from "segmentIndex:originalLabel" → canonicalLabel, plus canonical speaker list.
 */
export function reconcileSpeakers(params: ReconcileSpeakersParams): ReconciliationResult {
  const { pass1Results } = params;

  // name (lowercase) → { canonicalIndex, originalName (first seen casing), descriptions[], segmentIndices }
  const namedGroups = new Map<string, NamedGroup>();

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
    segIdx: number,
  ): number {
    const existing = namedGroups.get(name);
    if (existing) {
      if (description) existing.descriptions.push(description);
      existing.segmentIndices.add(segIdx);
      return existing.canonicalIndex;
    }
    const idx = nextCanonicalIndex++;
    namedGroups.set(name, {
      canonicalIndex: idx,
      originalName,
      descriptions: description ? [description] : [],
      segmentIndices: new Set([segIdx]),
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
        canonicalIdx = getOrAssignNamed(name, /* originalName */ parseOriginalName(label), description, segIdx);
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

  // ── Fuzzy merge pass ──────────────────────────────────────────────────────
  // For each pair of named groups that were NOT already exact-matched,
  // check Jaccard overlap on name tokens. If >= 0.5 and no temporal overlap,
  // merge the group with the higher canonical index into the group with the lower one.

  // mergedInto[canonicalIndex] = survivingCanonicalIndex
  const mergedInto = new Map<number, number>();

  /** Resolve the final canonical index after potential chains of merges. */
  function resolveIndex(idx: number): number {
    let current = idx;
    while (mergedInto.has(current)) {
      current = mergedInto.get(current)!;
    }
    return current;
  }

  const namedGroupKeys = Array.from(namedGroups.keys());

  for (let i = 0; i < namedGroupKeys.length; i++) {
    for (let j = i + 1; j < namedGroupKeys.length; j++) {
      const nameA = namedGroupKeys[i];
      const nameB = namedGroupKeys[j];

      // Only consider groups that are currently unmerged with each other
      const groupA = namedGroups.get(nameA)!;
      const groupB = namedGroups.get(nameB)!;
      const idxA = resolveIndex(groupA.canonicalIndex);
      const idxB = resolveIndex(groupB.canonicalIndex);
      if (idxA === idxB) continue; // already merged

      const overlap = jaccardOverlap(nameA, nameB);
      if (overlap < 0.5) continue;

      if (speakersOverlapTemporally(nameA, nameB, namedGroups, pass1Results)) continue;

      // Merge: absorb the group with the later canonical index into the earlier one
      const survivingIdx = Math.min(idxA, idxB);
      const absorbedIdx = Math.max(idxA, idxB);
      mergedInto.set(absorbedIdx, survivingIdx);

      // Find which named group key corresponds to the absorbed canonical index and
      // transfer its descriptions into the surviving group.
      // Identify surviving and absorbed groups by their resolved indices.
      const survivingName = idxA <= idxB ? nameA : nameB;
      const absorbedName = idxA <= idxB ? nameB : nameA;
      const survivingGroup = namedGroups.get(survivingName)!;
      const absorbedGroup = namedGroups.get(absorbedName)!;
      survivingGroup.descriptions.push(...absorbedGroup.descriptions);
      for (const si of absorbedGroup.segmentIndices) {
        survivingGroup.segmentIndices.add(si);
      }
    }
  }

  // Remap rawMapping entries that point to absorbed canonical indices
  if (mergedInto.size > 0) {
    for (const [mapKey, canonicalIdx] of rawMapping) {
      const resolved = resolveIndex(canonicalIdx);
      if (resolved !== canonicalIdx) {
        rawMapping.set(mapKey, resolved);
      }
    }
  }

  // Compact canonical indices: remove gaps left by merges
  // Build a sorted list of surviving indices in order of first assignment
  const survivingIndices = new Set<number>();
  for (let i = 0; i < nextCanonicalIndex; i++) {
    survivingIndices.add(resolveIndex(i));
  }
  // Map old index → new compact index (preserving order)
  const compactMap = new Map<number, number>();
  const sortedSurviving = Array.from(survivingIndices).sort((a, b) => a - b);
  sortedSurviving.forEach((oldIdx, newIdx) => {
    compactMap.set(oldIdx, newIdx);
  });

  // Build ordered canonical speakers array using only surviving groups
  const slots: Array<{ originalName: string | null; descriptions: string[] }> = Array.from(
    { length: sortedSurviving.length },
    () => ({ originalName: null, descriptions: [] }),
  );

  for (const [, group] of namedGroups) {
    const resolvedIdx = resolveIndex(group.canonicalIndex);
    const compactIdx = compactMap.get(resolvedIdx)!;
    // Only write slot for the "owner" of this resolved index (avoid double-write)
    if (slots[compactIdx].originalName === null && slots[compactIdx].descriptions.length === 0) {
      slots[compactIdx] = {
        originalName: group.originalName,
        descriptions: group.descriptions,
      };
    }
  }
  for (const [, group] of unnamedGroups) {
    const resolvedIdx = resolveIndex(group.canonicalIndex);
    const compactIdx = compactMap.get(resolvedIdx)!;
    if (slots[compactIdx].originalName === null && slots[compactIdx].descriptions.length === 0) {
      slots[compactIdx] = {
        originalName: null,
        descriptions: group.descriptions,
      };
    }
  }

  const canonicalSpeakers: CanonicalSpeaker[] = slots.map((slot, idx) => ({
    label: formatLabel(formatCanonicalBase(idx), slot.originalName),
    descriptions: slot.descriptions,
  }));

  // Build string mapping from "segIdx:originalLabel" → canonical label
  const mapping: Record<string, string> = {};
  for (const [mapKey, canonicalIdx] of rawMapping) {
    const compactIdx = compactMap.get(canonicalIdx)!;
    mapping[mapKey] = canonicalSpeakers[compactIdx].label;
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
