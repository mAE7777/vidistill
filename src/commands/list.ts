import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MetadataOutput } from '../output/metadata.js';

const DEFAULT_DIR = './vidistill-output/';

interface ListEntry {
  videoTitle: string;
  duration: number;
  type: string;
  generatedAt: string;
  fileCount: number;
}

function parseDir(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1] != null) {
      return args[i + 1]!;
    }
  }
  return DEFAULT_DIR;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${String(m)}m ${String(s)}s`;
}

function padEnd(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 1) + '…';
}

function scanEntries(dir: string): ListEntry[] {
  let subdirs: string[];
  try {
    subdirs = readdirSync(dir);
  } catch {
    return [];
  }

  const entries: ListEntry[] = [];

  for (const name of subdirs) {
    const fullPath = join(dir, name);
    try {
      const stat = statSync(fullPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    const metaPath = join(fullPath, 'metadata.json');
    try {
      const raw = readFileSync(metaPath, 'utf8');
      const meta = JSON.parse(raw) as MetadataOutput;
      entries.push({
        videoTitle: meta.videoTitle ?? '(unknown)',
        duration: meta.duration ?? 0,
        type: meta.type ?? 'unknown',
        generatedAt: meta.generatedAt ?? '',
        fileCount: Array.isArray(meta.filesGenerated) ? meta.filesGenerated.length : 0,
      });
    } catch {
      // skip missing or unparseable metadata.json
    }
  }

  return entries;
}

function displayTable(entries: ListEntry[]): void {
  // Sort by generatedAt descending (most recent first)
  const sorted = [...entries].sort((a, b) => {
    if (a.generatedAt === b.generatedAt) return 0;
    return a.generatedAt < b.generatedAt ? 1 : -1;
  });

  const TITLE_MAX = 40;

  const colWidths = {
    title: Math.max(5, ...sorted.map((e) => Math.min(truncate(e.videoTitle, TITLE_MAX).length, TITLE_MAX))),
    duration: Math.max(8, ...sorted.map((e) => formatDuration(e.duration).length)),
    type: Math.max(4, ...sorted.map((e) => e.type.length)),
    date: Math.max(4, ...sorted.map((e) => e.generatedAt.slice(0, 10).length)),
    files: 5,
  };

  const header = [
    padEnd('Title', colWidths.title),
    padEnd('Duration', colWidths.duration),
    padEnd('Type', colWidths.type),
    padEnd('Date', colWidths.date),
    padEnd('Files', colWidths.files),
  ].join('  ');

  const separator = [
    '-'.repeat(colWidths.title),
    '-'.repeat(colWidths.duration),
    '-'.repeat(colWidths.type),
    '-'.repeat(colWidths.date),
    '-'.repeat(colWidths.files),
  ].join('  ');

  console.log(header);
  console.log(separator);

  for (const entry of sorted) {
    const row = [
      padEnd(truncate(entry.videoTitle, TITLE_MAX), colWidths.title),
      padEnd(formatDuration(entry.duration), colWidths.duration),
      padEnd(entry.type, colWidths.type),
      padEnd(entry.generatedAt.slice(0, 10), colWidths.date),
      padEnd(String(entry.fileCount), colWidths.files),
    ].join('  ');
    console.log(row);
  }
}

export async function run(args: string[]): Promise<void> {
  const dir = parseDir(args);
  const entries = scanEntries(dir);

  if (entries.length === 0) {
    console.log(`No vidistill output found in ${dir}`);
    return;
  }

  displayTable(entries);
}
