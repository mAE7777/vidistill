import type { CodeFile, CodeReconstruction, Pass2Result, CodeChange, ChatExtraction, ExtractedLink } from '../types/index.js';
import { normalizeFilename } from '../lib/utils.js';

export interface ConsensusConfig {
  runs: number;
  minAgreement: number;
}

export interface ConsensusResult {
  confirmed: CodeFile[];
  rejected: string[];
  runsCompleted: number;
  runsAttempted: number;
  mergedDependencies: string[];
  mergedBuildCommands: string[];
}

/**
 * Tokenize content into a set of word/token strings for overlap scoring.
 */
function tokenize(content: string): Set<string> {
  const tokens = content.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return new Set(tokens);
}

/**
 * Compute token overlap between two strings (Jaccard-like intersection count).
 */
function tokenOverlap(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  let count = 0;
  for (const t of setA) {
    if (setB.has(t)) count++;
  }
  return count;
}

/**
 * Select the best content version for a confirmed file by comparing
 * token overlap against all pass2 code_blocks matching that filename.
 * Tie-break: longest content wins.
 */
function selectBestContent(
  normalizedName: string,
  candidates: CodeFile[],
  pass2Results: (Pass2Result | null)[],
): CodeFile {
  // Collect all pass2 code block content for this filename
  const referenceContent: string[] = [];
  for (const p2 of pass2Results) {
    if (p2 == null) continue;
    for (const block of p2.code_blocks ?? []) {
      if (block.filename && normalizeFilename(block.filename) === normalizedName) {
        referenceContent.push(block.content);
      }
    }
  }

  const referenceText = referenceContent.join('\n');

  let bestFile = candidates[0];
  let bestScore = -1;

  for (const candidate of candidates) {
    let score: number;
    if (referenceText.length === 0) {
      // No reference: score by content length
      score = candidate.final_content.length;
    } else {
      score = tokenOverlap(candidate.final_content, referenceText);
    }

    if (
      score > bestScore ||
      (score === bestScore && candidate.final_content.length > bestFile.final_content.length)
    ) {
      bestScore = score;
      bestFile = candidate;
    }
  }

  return bestFile;
}

/**
 * Merge change histories, deduplicating by timestamp + change_type.
 */
function mergeChanges(allChanges: CodeChange[][]): CodeChange[] {
  const seen = new Set<string>();
  const merged: CodeChange[] = [];
  for (const changes of allChanges) {
    for (const change of changes) {
      const key = `${change.timestamp}|${change.change_type}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(change);
      }
    }
  }
  return merged;
}

/**
 * Union and deduplicate an array of string arrays.
 */
function unionDedup(arrays: string[][]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const arr of arrays) {
    for (const item of arr) {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }
  }
  return result;
}

export async function runCodeConsensus(params: {
  config: ConsensusConfig;
  runFn: () => Promise<CodeReconstruction>;
  pass2Results: (Pass2Result | null)[];
  onProgress?: (run: number, total: number) => void;
}): Promise<ConsensusResult> {
  const { config, runFn, pass2Results, onProgress } = params;
  const { runs, minAgreement } = config;

  const successfulRuns: CodeReconstruction[] = [];

  // Execute runs sequentially
  for (let i = 0; i < runs; i++) {
    try {
      const result = await runFn();
      successfulRuns.push(result);
    } catch {
      // Individual run failures are expected — consensus only needs minAgreement runs to succeed
    }
    onProgress?.(i + 1, runs);
  }

  const runsCompleted = successfulRuns.length;

  // All failed
  if (runsCompleted === 0) {
    return {
      confirmed: [],
      rejected: [],
      runsCompleted: 0,
      runsAttempted: runs,
      mergedDependencies: [],
      mergedBuildCommands: [],
    };
  }

  // Single-run shortcut: all files are confirmed
  if (runs === 1 && runsCompleted === 1) {
    const only = successfulRuns[0];
    return {
      confirmed: only.files,
      rejected: [],
      runsCompleted: 1,
      runsAttempted: 1,
      mergedDependencies: [...new Set(only.dependencies_mentioned)],
      mergedBuildCommands: [...new Set(only.build_commands)],
    };
  }

  // Vote on files across runs
  // Map: normalizedName → { count, originals }
  const voteMap = new Map<string, { count: number; originals: CodeFile[] }>();

  for (const run of successfulRuns) {
    // Skip empty runs for file counting (but still count deps/commands)
    if (run.files.length === 0) continue;

    // Track which normalized names we've seen in THIS run to avoid double-counting
    const seenInRun = new Set<string>();

    for (const file of run.files) {
      if (!file.filename) continue;
      const normalized = normalizeFilename(file.filename);
      if (seenInRun.has(normalized)) continue;
      seenInRun.add(normalized);

      const entry = voteMap.get(normalized);
      if (entry == null) {
        voteMap.set(normalized, { count: 1, originals: [file] });
      } else {
        entry.count++;
        entry.originals.push(file);
      }
    }
  }

  // Classify files
  const confirmed: CodeFile[] = [];
  const rejected: string[] = [];

  for (const [normalizedName, { count, originals }] of voteMap.entries()) {
    if (count >= minAgreement) {
      // Select best content version
      const bestBase = selectBestContent(normalizedName, originals, pass2Results);

      // Merge changes from all versions
      const mergedChanges = mergeChanges(originals.map(f => f.changes));

      confirmed.push({
        filename: bestBase.filename,
        language: bestBase.language,
        final_content: bestBase.final_content,
        changes: mergedChanges,
      });
    } else {
      // Use original name from first occurrence
      rejected.push(originals[0].filename);
    }
  }

  // Merge dependencies and build_commands across all successful runs
  const mergedDependencies = unionDedup(successfulRuns.map(r => r.dependencies_mentioned));
  const mergedBuildCommands = unionDedup(successfulRuns.map(r => r.build_commands));

  return {
    confirmed,
    rejected,
    runsCompleted,
    runsAttempted: runs,
    mergedDependencies,
    mergedBuildCommands,
  };
}

// ---------------------------------------------------------------------------
// Link consensus
// ---------------------------------------------------------------------------

export interface LinkConsensusResult {
  /** Merged ChatExtraction with consensus-voted links */
  merged: ChatExtraction | null;
  rejectedUrls: string[];
  runsCompleted: number;
  runsAttempted: number;
}

/**
 * Normalize a URL for consensus matching.
 * Strips protocol, www prefix, and trailing slash so that
 * "https://www.example.com/" and "http://example.com" match.
 */
function normalizeUrl(url: string): string {
  let u = url.toLowerCase().trim();
  u = u.replace(/^https?:\/\//, '');
  u = u.replace(/^www\./, '');
  u = u.replace(/\/$/, '');
  return u;
}

/**
 * Run chat extraction multiple times and keep only links that appear
 * in at least `minAgreement` runs. Filters hallucinated URLs that
 * only appear in a single run.
 */
export async function runLinkConsensus(params: {
  config: ConsensusConfig;
  runFn: () => Promise<ChatExtraction>;
  onProgress?: (run: number, total: number) => void;
}): Promise<LinkConsensusResult> {
  const { config, runFn, onProgress } = params;
  const { runs, minAgreement } = config;

  const successfulRuns: ChatExtraction[] = [];

  for (let i = 0; i < runs; i++) {
    try {
      const result = await runFn();
      successfulRuns.push(result);
    } catch {
      // Individual run failures are expected — consensus only needs minAgreement runs to succeed
    }
    onProgress?.(i + 1, runs);
  }

  const runsCompleted = successfulRuns.length;

  if (runsCompleted === 0) {
    return { merged: null, rejectedUrls: [], runsCompleted: 0, runsAttempted: runs };
  }

  // Single-run shortcut
  if (runs === 1 && runsCompleted === 1) {
    return {
      merged: successfulRuns[0],
      rejectedUrls: [],
      runsCompleted: 1,
      runsAttempted: 1,
    };
  }

  // Vote on links across runs by normalized URL
  const voteMap = new Map<string, { count: number; originals: ExtractedLink[] }>();

  for (const run of successfulRuns) {
    const seenInRun = new Set<string>();
    for (const link of run.links ?? []) {
      if (!link.url) continue;
      const normalized = normalizeUrl(link.url);
      if (seenInRun.has(normalized)) continue;
      seenInRun.add(normalized);

      const entry = voteMap.get(normalized);
      if (entry == null) {
        voteMap.set(normalized, { count: 1, originals: [link] });
      } else {
        entry.count++;
        entry.originals.push(link);
      }
    }
  }

  const confirmedLinks: ExtractedLink[] = [];
  const rejectedUrls: string[] = [];

  for (const [, { count, originals }] of voteMap.entries()) {
    if (count >= minAgreement) {
      // Select the version with the longest context for best detail
      const best = originals.reduce((a, b) =>
        (b.context?.length ?? 0) > (a.context?.length ?? 0) ? b : a,
      );
      confirmedLinks.push(best);
    } else {
      rejectedUrls.push(originals[0].url);
    }
  }

  // Use messages from the run with the most messages
  const bestMessages = successfulRuns.reduce((a, b) =>
    (b.messages?.length ?? 0) > (a.messages?.length ?? 0) ? b : a,
  );

  return {
    merged: { messages: bestMessages.messages ?? [], links: confirmedLinks },
    rejectedUrls,
    runsCompleted,
    runsAttempted: runs,
  };
}
