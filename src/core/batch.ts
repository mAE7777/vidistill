import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import { relative } from 'path';
import { slugify } from '../output/generator.js';

export interface BatchItem {
  input: string;
  context?: string;
}

export interface BatchResultItem {
  input: string;
  outputDir: string;
  title: string;
  duration: number;
  success: boolean;
  error?: string;
}

export interface BatchResult {
  items: BatchResultItem[];
}

/**
 * Read a batch file and return parsed BatchItems.
 * - Lines starting with `#` are comments and are skipped.
 * - Empty lines are skipped.
 * - Lines may contain a `|` separator: `url|context`.
 */
export function parseBatchFile(filePath: string): BatchItem[] {
  if (!existsSync(filePath)) {
    throw new Error(`Batch file not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');
  const items: BatchItem[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const pipeIndex = trimmed.indexOf('|');
    if (pipeIndex !== -1) {
      const input = trimmed.slice(0, pipeIndex).trim();
      const context = trimmed.slice(pipeIndex + 1).trim();
      items.push({ input, context: context !== '' ? context : undefined });
    } else {
      items.push({ input: trimmed });
    }
  }

  return items;
}

/**
 * Format a duration in seconds as human-readable string.
 * e.g. 330 → "5:30", 3930 → "1:05:30"
 */
function formatDuration(seconds: number): string {
  const totalSecs = Math.round(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Generate an `index.md` listing all processed videos.
 * Returns the markdown string; the caller is responsible for writing it to disk.
 */
export function generateBatchIndex(results: BatchResult, outputDir: string): string {
  const lines: string[] = [];
  lines.push('# Batch Index');
  lines.push('');
  lines.push(`${results.items.length} item${results.items.length !== 1 ? 's' : ''} processed`);
  lines.push('');
  lines.push('| # | Title | Duration | Status | Link |');
  lines.push('|---|-------|----------|--------|------|');

  for (let i = 0; i < results.items.length; i++) {
    const item = results.items[i];
    const num = i + 1;
    const title = item.title;
    const duration = item.success ? formatDuration(item.duration) : '—';
    const status = item.success ? 'OK' : `Error: ${item.error ?? 'unknown'}`;

    let link: string;
    if (item.success) {
      const relPath = relative(outputDir, item.outputDir);
      const slug = slugify(title);
      link = `[${slug}](${relPath}/guide.md)`;
    } else {
      link = '—';
    }

    lines.push(`| ${num} | ${title} | ${duration} | ${status} | ${link} |`);
  }

  lines.push('');
  return lines.join('\n');
}
