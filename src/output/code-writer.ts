import { changeTypeBadge, parseTimestamp } from '../lib/utils.js';
import type { PipelineResult, CodeFile, CodeChange } from '../types/index.js';

export interface WriteCodeFilesParams {
  pipelineResult: PipelineResult;
  uncertainFiles?: Set<string>;
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

function buildTimeline(allFiles: CodeFile[]): string {
  if (allFiles.length === 0) {
    return '# Code Timeline\n\nNo code files could be reliably reconstructed.';
  }

  const lines: string[] = ['# Code Timeline', ''];

  // Collect all changes with their file attribution
  interface AnnotatedChange {
    timestamp: string;
    file: CodeFile;
    change: CodeChange;
  }

  const annotated: AnnotatedChange[] = [];
  for (const file of allFiles) {
    for (const change of file.changes) {
      annotated.push({ timestamp: change.timestamp, file, change });
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
  for (const file of allFiles) {
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
  const { pipelineResult, uncertainFiles } = params;
  const { codeReconstruction } = pipelineResult;

  const allFiles: CodeFile[] = [];
  const files = new Map<string, string>();

  if (codeReconstruction != null) {
    for (const file of codeReconstruction.files) {
      allFiles.push(file);
      let content = file.final_content;
      if (uncertainFiles?.has(file.filename)) {
        content = `// [note: this file passed consensus but could not be cross-referenced against visual observations — content may be approximate]\n${content}`;
      }
      files.set(file.filename, content);
    }
  }

  const timeline = buildTimeline(allFiles);

  return { files, timeline };
}
