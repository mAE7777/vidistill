export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [
    String(h).padStart(2, '0'),
    String(m).padStart(2, '0'),
    String(s).padStart(2, '0'),
  ].join(':');
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function parseTimestamp(ts: string): number {
  const parts = ts.trim().split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0);
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return (m ?? 0) * 60 + (s ?? 0);
  }
  return parts[0] ?? 0;
}

/**
 * Normalize a filename for comparison:
 * - lowercase
 * - strip leading ./
 * - unify path separators to forward slashes
 */
export function normalizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/^\.\//, '')
    .replace(/\\/g, '/');
}

export function applySpeakerMapping(label: string, mapping?: Record<string, string>): string {
  return mapping?.[label] ?? label;
}

export function changeTypeBadge(changeType: string): string {
  const badges: Record<string, string> = {
    new_file: '[NEW]',
    addition: '[ADD]',
    modification: '[MOD]',
    deletion: '[DEL]',
    unchanged: '[---]',
    scroll: '[SCR]',
  };
  return badges[changeType] || `[${changeType.toUpperCase()}]`;
}
