import type { CodeFile, Pass2Result } from '../types/index.js';
import type { ConsensusResult } from './consensus.js';
import { normalizeFilename } from '../lib/utils.js';

export interface ValidationWarning {
  gate: number;
  filename: string;
  message: string;
}

export interface ValidationResult {
  confirmed: CodeFile[];
  uncertain: CodeFile[];
  rejected: CodeFile[];
  warnings: ValidationWarning[];
}

/** Allowed filename characters: letters, digits, dot, underscore, hyphen, forward-slash */
const VALID_FILENAME_CHARS = /^[a-zA-Z0-9._\-\/]+$/;

/** Placeholder content patterns (trimmed, case-sensitive) */
const PLACEHOLDER_PATTERNS = new Set(['// TODO', '// empty file', '# TODO', '/* TODO */']);

/**
 * Return the basename (last path component) of a filename.
 */
function basename(filename: string): string {
  const normalized = normalizeFilename(filename);
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? normalized;
}

/**
 * Collect all filenames referenced in pass2 code_blocks, normalized and as basenames.
 */
function collectPass2Filenames(pass2Results: (Pass2Result | null)[]): {
  normalized: Set<string>;
  basenames: Set<string>;
} {
  const normalized = new Set<string>();
  const basenames = new Set<string>();

  for (const p2 of pass2Results) {
    if (p2 == null) continue;
    for (const block of p2.code_blocks) {
      if (!block.filename) continue;
      const norm = normalizeFilename(block.filename);
      normalized.add(norm);
      basenames.add(basename(block.filename));
    }
  }

  return { normalized, basenames };
}

/**
 * Gate 1: Structural validation.
 * Returns a warning message if the file fails, or null if it passes.
 */
function checkGate1(file: CodeFile): string | null {
  if (!file.filename || file.filename.trim() === '') {
    return 'empty filename';
  }
  if (!file.final_content || file.final_content.trim() === '') {
    return 'empty content';
  }
  if (!file.language || file.language.trim() === '') {
    return 'empty language';
  }
  if (file.changes.length === 0) {
    return 'no changes recorded';
  }
  return null;
}

/**
 * Gate 2: Filesystem safety.
 * Returns a warning message if the file fails, or null if it passes.
 */
function checkGate2(filename: string): string | null {
  if (filename.includes('../')) {
    return 'path traversal';
  }
  if (filename.startsWith('/')) {
    return 'absolute path';
  }
  if (!VALID_FILENAME_CHARS.test(filename)) {
    return 'invalid characters';
  }
  return null;
}

/**
 * Gate 3: Cross-reference against pass2 code_blocks.
 * Returns true if the file is "ungrounded" (no matching pass2 filename).
 * This is a warning only — not a rejection.
 */
function checkGate3Ungrounded(
  filename: string,
  pass2Normalized: Set<string>,
  pass2Basenames: Set<string>,
): boolean {
  const norm = normalizeFilename(filename);
  const base = basename(filename);

  // Match by full normalized path or by basename
  if (pass2Normalized.has(norm) || pass2Basenames.has(base)) {
    return false;
  }

  return true;
}

/**
 * Gate 5: Content quality.
 * Returns a warning message if the file fails, or null if it passes.
 */
function checkGate5(file: CodeFile): string | null {
  if (PLACEHOLDER_PATTERNS.has(file.final_content.trim())) {
    return 'placeholder content';
  }
  if (file.final_content.length <= 20) {
    return 'trivially short content';
  }
  return null;
}

/**
 * Validate all confirmed files from the consensus result, applying 5 gates:
 *
 * Gate 1 — Structural: non-empty filename, content, language; at least one change
 * Gate 2 — Filesystem safety: no path traversal, no absolute paths, valid characters
 * Gate 3 — Cross-reference: filename appears (exact or basename) in pass2 code_blocks
 * Gate 4 — Consensus: file is in consensusResult.confirmed (implicit — only confirmed files are processed)
 * Gate 5 — Content quality: content longer than 20 chars; not placeholder text
 *
 * Classification:
 * - confirmed: all 5 gates pass
 * - uncertain: gates 1,2,4,5 pass but gate 3 fails (ungrounded)
 * - rejected: gate 1, 2, or 5 fails
 */
export function validateCodeReconstruction(params: {
  consensusResult: ConsensusResult;
  pass2Results: (Pass2Result | null)[];
}): ValidationResult {
  const { consensusResult, pass2Results } = params;

  const confirmed: CodeFile[] = [];
  const uncertain: CodeFile[] = [];
  const rejected: CodeFile[] = [];
  const warnings: ValidationWarning[] = [];

  // Collect pass2 filename sets once for all files
  const { normalized: pass2Normalized, basenames: pass2Basenames } = collectPass2Filenames(pass2Results);

  for (const file of consensusResult.confirmed) {
    const gate1Failure = checkGate1(file);
    if (gate1Failure != null) {
      warnings.push({ gate: 1, filename: file.filename, message: gate1Failure });
      rejected.push(file);
      continue;
    }

    const gate2Failure = checkGate2(file.filename);
    if (gate2Failure != null) {
      warnings.push({ gate: 2, filename: file.filename, message: gate2Failure });
      rejected.push(file);
      continue;
    }

    // Gate 4: implicit — we only iterate consensusResult.confirmed, so gate 4 always passes here.
    // (Files not in confirmed are already excluded by consensus.)

    const gate5Failure = checkGate5(file);
    if (gate5Failure != null) {
      warnings.push({ gate: 5, filename: file.filename, message: gate5Failure });
      rejected.push(file);
      continue;
    }

    // Gate 3: cross-reference (warning only, determines confirmed vs uncertain)
    const isUngrounded = checkGate3Ungrounded(file.filename, pass2Normalized, pass2Basenames);
    if (isUngrounded) {
      warnings.push({ gate: 3, filename: file.filename, message: 'ungrounded' });
      uncertain.push(file);
      continue;
    }

    confirmed.push(file);
  }

  return { confirmed, uncertain, rejected, warnings };
}
