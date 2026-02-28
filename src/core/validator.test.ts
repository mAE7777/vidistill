import { describe, it, expect } from 'vitest';
import { validateCodeReconstruction } from './validator.js';
import type { ValidationResult } from './validator.js';
import type { CodeFile, Pass2Result, CodeChange, CodeBlock } from '../types/index.js';
import type { ConsensusResult } from './consensus.js';

// ──────────────────────────────────────────────
// Factory helpers
// ──────────────────────────────────────────────

function makeCodeChange(overrides: Partial<CodeChange> = {}): CodeChange {
  return {
    timestamp: '00:00:10',
    change_type: 'create',
    description: 'Initial file creation',
    diff_summary: 'Added content',
    ...overrides,
  };
}

function makeCodeFile(overrides: Partial<CodeFile> = {}): CodeFile {
  return {
    filename: 'main.py',
    language: 'python',
    final_content: 'def hello():\n    print("hello world")\n\nhello()',
    changes: [makeCodeChange()],
    ...overrides,
  };
}

function makeCodeBlock(overrides: Partial<CodeBlock> = {}): CodeBlock {
  return {
    timestamp: '00:00:10',
    filename: 'main.py',
    language: 'python',
    content: 'def hello(): pass',
    screen_type: 'code_editor',
    change_type: 'create',
    instructor_explanation: '',
    ...overrides,
  };
}

function makePass2Result(overrides: Partial<Pass2Result> = {}): Pass2Result {
  return {
    segment_index: 0,
    time_range: '00:00:00 - 00:01:00',
    code_blocks: [],
    visual_notes: [],
    screen_timeline: [],
    ...overrides,
  };
}

function makeConsensusResult(overrides: Partial<ConsensusResult> = {}): ConsensusResult {
  return {
    confirmed: [],
    rejected: [],
    runsCompleted: 3,
    runsAttempted: 3,
    mergedDependencies: [],
    mergedBuildCommands: [],
    ...overrides,
  };
}

// Helper: call validateCodeReconstruction with a single confirmed file and optional pass2 results
function validateSingle(
  file: CodeFile,
  pass2Results: (Pass2Result | null)[] = [],
): ValidationResult {
  return validateCodeReconstruction({
    consensusResult: makeConsensusResult({ confirmed: [file] }),
    pass2Results,
  });
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('validateCodeReconstruction', () => {
  // ── Gate 1: Structural ────────────────────────

  describe('gate 1 — structural', () => {
    it('rejects a file with an empty filename', () => {
      const file = makeCodeFile({ filename: '' });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.confirmed).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].gate).toBe(1);
      expect(result.warnings[0].message).toBe('empty filename');
    });

    it('rejects a file with a whitespace-only filename', () => {
      const file = makeCodeFile({ filename: '   ' });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.warnings[0].gate).toBe(1);
      expect(result.warnings[0].message).toBe('empty filename');
    });

    it('rejects a file with empty final_content', () => {
      const file = makeCodeFile({ final_content: '' });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.warnings[0].gate).toBe(1);
      expect(result.warnings[0].message).toBe('empty content');
    });

    it('rejects a file with whitespace-only final_content', () => {
      const file = makeCodeFile({ final_content: '   \n\t  ' });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.warnings[0].message).toBe('empty content');
    });

    it('rejects a file with empty language', () => {
      const file = makeCodeFile({ language: '' });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.warnings[0].gate).toBe(1);
      expect(result.warnings[0].message).toBe('empty language');
    });

    it('rejects a file with 0 changes', () => {
      const file = makeCodeFile({ changes: [] });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.warnings[0].gate).toBe(1);
      expect(result.warnings[0].message).toBe('no changes recorded');
    });

    it('passes gate 1 for a valid file with all required fields', () => {
      const file = makeCodeFile();
      const pass2 = makePass2Result({ code_blocks: [makeCodeBlock({ filename: 'main.py' })] });
      const result = validateSingle(file, [pass2]);

      expect(result.rejected).toHaveLength(0);
      expect(result.warnings.filter(w => w.gate === 1)).toHaveLength(0);
    });
  });

  // ── Gate 2: Filesystem safety ─────────────────

  describe('gate 2 — filesystem safety', () => {
    it('rejects a filename containing ../', () => {
      const file = makeCodeFile({ filename: '../secret.py' });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.warnings[0].gate).toBe(2);
      expect(result.warnings[0].message).toBe('path traversal');
    });

    it('rejects a filename containing ../ in the middle of the path', () => {
      const file = makeCodeFile({ filename: 'src/../../../etc/passwd' });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.warnings[0].message).toBe('path traversal');
    });

    it('rejects a filename starting with /', () => {
      const file = makeCodeFile({ filename: '/etc/passwd' });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.warnings[0].gate).toBe(2);
      expect(result.warnings[0].message).toBe('absolute path');
    });

    it('rejects a filename with invalid characters (space)', () => {
      const file = makeCodeFile({ filename: 'my file.py' });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.warnings[0].gate).toBe(2);
      expect(result.warnings[0].message).toBe('invalid characters');
    });

    it('rejects a filename with invalid characters (semicolon)', () => {
      const file = makeCodeFile({ filename: 'file;rm.py' });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.warnings[0].message).toBe('invalid characters');
    });

    it('accepts a valid filename with subdirectory path', () => {
      const file = makeCodeFile({ filename: 'src/utils/helper.py' });
      const pass2 = makePass2Result({
        code_blocks: [makeCodeBlock({ filename: 'src/utils/helper.py' })],
      });
      const result = validateSingle(file, [pass2]);

      expect(result.rejected).toHaveLength(0);
      expect(result.warnings.filter(w => w.gate === 2)).toHaveLength(0);
    });

    it('accepts filenames with dots, underscores, and hyphens', () => {
      const file = makeCodeFile({ filename: 'my-module_v2.test.ts' });
      const pass2 = makePass2Result({
        code_blocks: [makeCodeBlock({ filename: 'my-module_v2.test.ts' })],
      });
      const result = validateSingle(file, [pass2]);

      expect(result.warnings.filter(w => w.gate === 2)).toHaveLength(0);
    });
  });

  // ── Gate 3: Cross-reference ───────────────────

  describe('gate 3 — cross-reference', () => {
    it('does NOT mark a file as ungrounded when pass2 has exact filename match', () => {
      const file = makeCodeFile({ filename: 'main.py' });
      const pass2 = makePass2Result({
        code_blocks: [makeCodeBlock({ filename: 'main.py' })],
      });
      const result = validateSingle(file, [pass2]);

      expect(result.confirmed).toHaveLength(1);
      expect(result.uncertain).toHaveLength(0);
      expect(result.warnings.filter(w => w.gate === 3)).toHaveLength(0);
    });

    it('does NOT mark a file as ungrounded when pass2 has matching basename (src/main.py vs main.py)', () => {
      const file = makeCodeFile({ filename: 'main.py' });
      const pass2 = makePass2Result({
        code_blocks: [makeCodeBlock({ filename: 'src/main.py' })],
      });
      const result = validateSingle(file, [pass2]);

      expect(result.confirmed).toHaveLength(1);
      expect(result.uncertain).toHaveLength(0);
    });

    it('marks a file as ungrounded (warning only) when no pass2 filename matches', () => {
      const file = makeCodeFile({ filename: 'main.py' });
      const pass2 = makePass2Result({
        code_blocks: [makeCodeBlock({ filename: 'other.py' })],
      });
      const result = validateSingle(file, [pass2]);

      expect(result.uncertain).toHaveLength(1);
      expect(result.rejected).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].gate).toBe(3);
      expect(result.warnings[0].message).toBe('ungrounded');
    });

    it('places ungrounded file in uncertain (not rejected)', () => {
      const file = makeCodeFile({ filename: 'orphan.py' });
      const result = validateSingle(file, []);

      expect(result.uncertain).toHaveLength(1);
      expect(result.rejected).toHaveLength(0);
    });

    it('performs case-insensitive filename comparison', () => {
      const file = makeCodeFile({ filename: 'Main.py' });
      const pass2 = makePass2Result({
        code_blocks: [makeCodeBlock({ filename: 'main.py' })],
      });
      const result = validateSingle(file, [pass2]);

      // Gate 2 rejects 'Main.py' because capital M is allowed, but let's confirm no gate 3 warning
      // Actually Main.py is valid per gate 2 (all chars are a-zA-Z0-9._-/)
      expect(result.warnings.filter(w => w.gate === 3)).toHaveLength(0);
      expect(result.confirmed).toHaveLength(1);
    });

    it('matches when pass2 has the full path and file has just the basename', () => {
      const file = makeCodeFile({ filename: 'utils.py' });
      const pass2 = makePass2Result({
        code_blocks: [makeCodeBlock({ filename: 'src/utils.py' })],
      });
      const result = validateSingle(file, [pass2]);

      expect(result.confirmed).toHaveLength(1);
      expect(result.uncertain).toHaveLength(0);
    });

    it('marks ungrounded when pass2Results is empty array', () => {
      const file = makeCodeFile({ filename: 'main.py' });
      const result = validateSingle(file, []);

      expect(result.uncertain).toHaveLength(1);
      expect(result.warnings[0].gate).toBe(3);
    });

    it('marks ungrounded when pass2Results contains only null entries', () => {
      const file = makeCodeFile({ filename: 'main.py' });
      const result = validateSingle(file, [null, null]);

      expect(result.uncertain).toHaveLength(1);
    });
  });

  // ── Gate 4: Consensus ─────────────────────────

  describe('gate 4 — consensus', () => {
    it('only processes files in consensusResult.confirmed', () => {
      const confirmedFile = makeCodeFile({ filename: 'main.py' });
      const pass2 = makePass2Result({
        code_blocks: [makeCodeBlock({ filename: 'main.py' })],
      });
      const result = validateCodeReconstruction({
        consensusResult: makeConsensusResult({
          confirmed: [confirmedFile],
          rejected: ['utils.py'],
        }),
        pass2Results: [pass2],
      });

      // Only the confirmed file is processed; rejected filenames from consensus are ignored
      expect(result.confirmed).toHaveLength(1);
      expect(result.confirmed[0].filename).toBe('main.py');
      // utils.py does not appear in any output bucket
      const allFiles = [...result.confirmed, ...result.uncertain, ...result.rejected];
      expect(allFiles.every(f => f.filename !== 'utils.py')).toBe(true);
    });

    it('passes gate 4 for every file in consensusResult.confirmed', () => {
      const files = [
        makeCodeFile({ filename: 'a.py' }),
        makeCodeFile({ filename: 'b.py' }),
      ];
      const pass2 = makePass2Result({
        code_blocks: [
          makeCodeBlock({ filename: 'a.py' }),
          makeCodeBlock({ filename: 'b.py' }),
        ],
      });
      const result = validateCodeReconstruction({
        consensusResult: makeConsensusResult({ confirmed: files }),
        pass2Results: [pass2],
      });

      // Gate 4 always passes for confirmed files; no gate 4 warnings
      expect(result.warnings.filter(w => w.gate === 4)).toHaveLength(0);
    });
  });

  // ── Gate 5: Content quality ───────────────────

  describe('gate 5 — content quality', () => {
    it('rejects a file with final_content.length <= 20', () => {
      const file = makeCodeFile({ final_content: 'x = 1' }); // 5 chars
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.warnings[0].gate).toBe(5);
      expect(result.warnings[0].message).toBe('trivially short content');
    });

    it('rejects a file with final_content exactly 20 characters', () => {
      const file = makeCodeFile({ final_content: '12345678901234567890' }); // exactly 20
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.warnings[0].gate).toBe(5);
      expect(result.warnings[0].message).toBe('trivially short content');
    });

    it('accepts a file with final_content of 21 characters', () => {
      const file = makeCodeFile({ filename: 'main.py', final_content: '123456789012345678901' }); // 21 chars
      const pass2 = makePass2Result({ code_blocks: [makeCodeBlock({ filename: 'main.py' })] });
      const result = validateSingle(file, [pass2]);

      expect(result.warnings.filter(w => w.gate === 5)).toHaveLength(0);
    });

    it('rejects a file with "// TODO" as content', () => {
      const file = makeCodeFile({ final_content: '// TODO' });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.warnings[0].gate).toBe(5);
      expect(result.warnings[0].message).toBe('placeholder content');
    });

    it('rejects a file with "// empty file" as content', () => {
      const file = makeCodeFile({ final_content: '// empty file' });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.warnings[0].message).toBe('placeholder content');
    });

    it('rejects a file with "# TODO" as content', () => {
      const file = makeCodeFile({ final_content: '# TODO' });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.warnings[0].message).toBe('placeholder content');
    });

    it('rejects a file with "/* TODO */" as content', () => {
      const file = makeCodeFile({ final_content: '/* TODO */' });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.warnings[0].message).toBe('placeholder content');
    });

    it('rejects a placeholder content with surrounding whitespace', () => {
      const file = makeCodeFile({ final_content: '  // TODO  \n' });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.warnings[0].message).toBe('placeholder content');
    });

    it('accepts normal content that passes quality checks', () => {
      const file = makeCodeFile(); // default: 'def hello():\n    print("hello world")\n\nhello()'
      const pass2 = makePass2Result({ code_blocks: [makeCodeBlock({ filename: 'main.py' })] });
      const result = validateSingle(file, [pass2]);

      expect(result.warnings.filter(w => w.gate === 5)).toHaveLength(0);
    });
  });

  // ── Classification ────────────────────────────

  describe('output classification', () => {
    it('classifies a file passing all 5 gates as confirmed', () => {
      const file = makeCodeFile({ filename: 'main.py' });
      const pass2 = makePass2Result({ code_blocks: [makeCodeBlock({ filename: 'main.py' })] });
      const result = validateSingle(file, [pass2]);

      expect(result.confirmed).toHaveLength(1);
      expect(result.uncertain).toHaveLength(0);
      expect(result.rejected).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('classifies a file failing gate 3 only as uncertain', () => {
      const file = makeCodeFile({ filename: 'main.py' });
      // No pass2 results → gate 3 fails
      const result = validateSingle(file, []);

      expect(result.uncertain).toHaveLength(1);
      expect(result.confirmed).toHaveLength(0);
      expect(result.rejected).toHaveLength(0);
    });

    it('classifies a file failing gate 1 as rejected', () => {
      const file = makeCodeFile({ changes: [] });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.confirmed).toHaveLength(0);
      expect(result.uncertain).toHaveLength(0);
    });

    it('classifies a file failing gate 2 as rejected', () => {
      const file = makeCodeFile({ filename: '../traversal.py' });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.confirmed).toHaveLength(0);
      expect(result.uncertain).toHaveLength(0);
    });

    it('classifies a file failing gate 5 as rejected', () => {
      const file = makeCodeFile({ final_content: '// TODO' });
      const result = validateSingle(file);

      expect(result.rejected).toHaveLength(1);
      expect(result.confirmed).toHaveLength(0);
      expect(result.uncertain).toHaveLength(0);
    });

    it('handles a mix of confirmed, uncertain, and rejected files', () => {
      const confirmedFile = makeCodeFile({ filename: 'good.py' });
      const uncertainFile = makeCodeFile({ filename: 'orphan.py' }); // no pass2 match
      const rejectedFile = makeCodeFile({ filename: '../bad.py' }); // path traversal

      const pass2 = makePass2Result({
        code_blocks: [makeCodeBlock({ filename: 'good.py' })],
      });

      const result = validateCodeReconstruction({
        consensusResult: makeConsensusResult({
          confirmed: [confirmedFile, uncertainFile, rejectedFile],
        }),
        pass2Results: [pass2],
      });

      expect(result.confirmed.map(f => f.filename)).toContain('good.py');
      expect(result.uncertain.map(f => f.filename)).toContain('orphan.py');
      expect(result.rejected.map(f => f.filename)).toContain('../bad.py');
    });

    it('includes the correct filename in each warning', () => {
      const file = makeCodeFile({ filename: '' });
      const result = validateSingle(file);

      expect(result.warnings[0].filename).toBe('');
    });

    it('returns empty arrays when consensusResult has no confirmed files', () => {
      const result = validateCodeReconstruction({
        consensusResult: makeConsensusResult({ confirmed: [] }),
        pass2Results: [],
      });

      expect(result.confirmed).toHaveLength(0);
      expect(result.uncertain).toHaveLength(0);
      expect(result.rejected).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('handles multiple pass2 segments for cross-reference', () => {
      const file = makeCodeFile({ filename: 'utils.py' });
      const pass2a = makePass2Result({
        segment_index: 0,
        code_blocks: [makeCodeBlock({ filename: 'main.py' })],
      });
      const pass2b = makePass2Result({
        segment_index: 1,
        code_blocks: [makeCodeBlock({ filename: 'utils.py' })],
      });
      const result = validateSingle(file, [pass2a, pass2b]);

      expect(result.confirmed).toHaveLength(1);
      expect(result.uncertain).toHaveLength(0);
    });

    it('stops at gate 1 and does not check gate 2 for an empty filename', () => {
      const file = makeCodeFile({ filename: '' });
      const result = validateSingle(file);

      // Only one warning (gate 1), not multiple
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].gate).toBe(1);
    });
  });
});
