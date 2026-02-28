import { describe, it, expect } from 'vitest';
import { writeCodeFiles } from './code-writer.js';
import type { PipelineResult, SegmentResult, CodeReconstruction } from '../types/index.js';

function makePipelineResult(segments: SegmentResult[]): PipelineResult {
  return { segments, passesRun: [], errors: [] };
}

function makeSegment(index: number, pass3a: CodeReconstruction | null | undefined = undefined): SegmentResult {
  return { index, pass1: null, pass2: null, pass3a };
}

const CODE_RECONSTRUCTION: CodeReconstruction = {
  files: [
    {
      filename: 'src/app.ts',
      language: 'typescript',
      final_content: 'export function main() {\n  console.log("hello");\n}',
      changes: [
        {
          timestamp: '00:00:10',
          change_type: 'new_file',
          description: 'Created main app file',
          diff_summary: 'Added main function',
        },
        {
          timestamp: '00:02:30',
          change_type: 'modification',
          description: 'Added console log',
          diff_summary: '+1 line',
        },
      ],
    },
    {
      filename: 'tsconfig.json',
      language: 'json',
      final_content: '{"compilerOptions":{}}',
      changes: [
        {
          timestamp: '00:00:05',
          change_type: 'new_file',
          description: 'Created tsconfig',
          diff_summary: 'Initial setup',
        },
      ],
    },
  ],
  dependencies_mentioned: ['typescript'],
  build_commands: ['tsc', 'node dist/app.js'],
};

describe('writeCodeFiles', () => {
  it('returns empty files map when no segments have pass3a', () => {
    const result = writeCodeFiles({ pipelineResult: makePipelineResult([makeSegment(0)]) });
    expect(result.files.size).toBe(0);
  });

  it('returns files map with correct filenames', () => {
    const result = writeCodeFiles({
      pipelineResult: makePipelineResult([makeSegment(0, CODE_RECONSTRUCTION)]),
    });
    expect(result.files.has('src/app.ts')).toBe(true);
    expect(result.files.has('tsconfig.json')).toBe(true);
  });

  it('stores final_content for each file', () => {
    const result = writeCodeFiles({
      pipelineResult: makePipelineResult([makeSegment(0, CODE_RECONSTRUCTION)]),
    });
    expect(result.files.get('src/app.ts')).toBe('export function main() {\n  console.log("hello");\n}');
    expect(result.files.get('tsconfig.json')).toBe('{"compilerOptions":{}}');
  });

  it('last segment wins when same filename appears in multiple segments', () => {
    const seg1Recon: CodeReconstruction = {
      ...CODE_RECONSTRUCTION,
      files: [
        {
          filename: 'src/app.ts',
          language: 'typescript',
          final_content: 'version one',
          changes: [],
        },
      ],
    };
    const seg2Recon: CodeReconstruction = {
      ...CODE_RECONSTRUCTION,
      files: [
        {
          filename: 'src/app.ts',
          language: 'typescript',
          final_content: 'version two',
          changes: [],
        },
      ],
    };
    const result = writeCodeFiles({
      pipelineResult: makePipelineResult([makeSegment(0, seg1Recon), makeSegment(1, seg2Recon)]),
    });
    expect(result.files.get('src/app.ts')).toBe('version two');
  });

  it('returns a timeline string', () => {
    const result = writeCodeFiles({
      pipelineResult: makePipelineResult([makeSegment(0, CODE_RECONSTRUCTION)]),
    });
    expect(typeof result.timeline).toBe('string');
  });

  it('timeline contains # Code Timeline heading', () => {
    const result = writeCodeFiles({
      pipelineResult: makePipelineResult([makeSegment(0, CODE_RECONSTRUCTION)]),
    });
    expect(result.timeline).toContain('# Code Timeline');
  });

  it('timeline shows placeholder when no code files', () => {
    const result = writeCodeFiles({ pipelineResult: makePipelineResult([makeSegment(0)]) });
    expect(result.timeline).toContain('No code files reconstructed');
  });

  it('timeline contains change type badges', () => {
    const result = writeCodeFiles({
      pipelineResult: makePipelineResult([makeSegment(0, CODE_RECONSTRUCTION)]),
    });
    expect(result.timeline).toContain('[NEW]');
    expect(result.timeline).toContain('[MOD]');
  });

  it('timeline contains filenames', () => {
    const result = writeCodeFiles({
      pipelineResult: makePipelineResult([makeSegment(0, CODE_RECONSTRUCTION)]),
    });
    expect(result.timeline).toContain('src/app.ts');
    expect(result.timeline).toContain('tsconfig.json');
  });

  it('timeline lists changes sorted chronologically', () => {
    const result = writeCodeFiles({
      pipelineResult: makePipelineResult([makeSegment(0, CODE_RECONSTRUCTION)]),
    });
    // tsconfig created at 00:00:05, app created at 00:00:10
    const tsconfigPos = result.timeline.indexOf('00:00:05');
    const appPos = result.timeline.indexOf('00:00:10');
    expect(tsconfigPos).toBeGreaterThan(-1);
    expect(appPos).toBeGreaterThan(-1);
    expect(tsconfigPos).toBeLessThan(appPos);
  });

  it('timeline includes change descriptions', () => {
    const result = writeCodeFiles({
      pipelineResult: makePipelineResult([makeSegment(0, CODE_RECONSTRUCTION)]),
    });
    expect(result.timeline).toContain('Created main app file');
    expect(result.timeline).toContain('Created tsconfig');
  });

  it('handles null pass3a in segments gracefully', () => {
    const result = writeCodeFiles({
      pipelineResult: makePipelineResult([makeSegment(0, null), makeSegment(1, CODE_RECONSTRUCTION)]),
    });
    expect(result.files.size).toBe(2);
    expect(result.timeline).toContain('src/app.ts');
  });

  it('handles empty files array in pass3a', () => {
    const emptyRecon: CodeReconstruction = {
      files: [],
      dependencies_mentioned: [],
      build_commands: [],
    };
    const result = writeCodeFiles({
      pipelineResult: makePipelineResult([makeSegment(0, emptyRecon)]),
    });
    expect(result.files.size).toBe(0);
    expect(result.timeline).toContain('No code files reconstructed');
  });
});
