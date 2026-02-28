import { changeTypeBadge, parseTimestamp } from '../lib/utils.js';
import type { PipelineResult, CodeFile, CodeChange } from '../types/index.js';

export interface WriteCodeFilesParams {
  pipelineResult: PipelineResult;
}

export interface WriteCodeFilesResult {
  files: Map<string, string>;
  timeline: string;
}

function renderChangeRow(change: CodeChange): string {
  const badge = changeTypeBadge(change.change_type);
  const desc = change.description.length > 0 ? change.description : '_No description_';
  const diff = change.diff_summary.length > 0 ? change.diff_summary : '';
  const diffPart = diff.length > 0 ? ` — ${diff}` : '';
  return `| \`${change.timestamp}\` | ${badge} | ${desc}${diffPart} |`;
}

function buildTimeline(allFiles: Array<{ file: CodeFile; segmentIndex: number }>): string {
  if (allFiles.length === 0) {
    return '# Code Timeline\n\n_No code files reconstructed._';
  }

  const lines: string[] = ['# Code Timeline', ''];

  // Collect all changes with their file attribution
  interface AnnotatedChange {
    timestamp: string;
    file: CodeFile;
    change: CodeChange;
    segmentIndex: number;
  }

  const annotated: AnnotatedChange[] = [];
  for (const { file, segmentIndex } of allFiles) {
    for (const change of file.changes) {
      annotated.push({ timestamp: change.timestamp, file, change, segmentIndex });
    }
  }

  // Sort chronologically
  annotated.sort((a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp));

  if (annotated.length > 0) {
    lines.push('| Timestamp | Type | File | Description |');
    lines.push('|-----------|------|------|-------------|');
    for (const a of annotated) {
      const badge = changeTypeBadge(a.change.change_type);
      const desc =
        a.change.description.length > 0
          ? a.change.description + (a.change.diff_summary.length > 0 ? ` — ${a.change.diff_summary}` : '')
          : '_No description_';
      lines.push(`| \`${a.timestamp}\` | ${badge} | \`${a.file.filename}\` | ${desc} |`);
    }
    lines.push('');
  }

  // Per-file sections
  const seenFiles = new Set<string>();
  for (const { file } of allFiles) {
    if (seenFiles.has(file.filename)) continue;
    seenFiles.add(file.filename);

    lines.push(`## ${file.filename}`);
    lines.push('');
    lines.push(`**Language:** ${file.language}`);
    lines.push('');

    const fileChanges = annotated.filter((a) => a.file.filename === file.filename);
    if (fileChanges.length > 0) {
      lines.push('| Timestamp | Type | Description |');
      lines.push('|-----------|------|-------------|');
      for (const a of fileChanges) {
        lines.push(renderChangeRow(a.change));
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function writeCodeFiles(params: WriteCodeFilesParams): WriteCodeFilesResult {
  const { pipelineResult } = params;
  const { segments } = pipelineResult;

  // Collect all CodeFile instances across segments (pass3a)
  const allFiles: Array<{ file: CodeFile; segmentIndex: number }> = [];

  // Track the latest version of each filename (last segment wins for final content)
  const latestByFilename = new Map<string, { file: CodeFile; segmentIndex: number }>();

  for (const seg of segments) {
    if (seg.pass3a == null) continue;
    for (const file of seg.pass3a.files) {
      allFiles.push({ file, segmentIndex: seg.index });
      latestByFilename.set(file.filename, { file, segmentIndex: seg.index });
    }
  }

  // Build individual file contents map
  const files = new Map<string, string>();
  for (const [filename, { file }] of latestByFilename) {
    files.set(filename, file.final_content);
  }

  const timeline = buildTimeline(allFiles);

  return { files, timeline };
}
