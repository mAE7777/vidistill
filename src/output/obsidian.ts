export interface ObsidianMetadata {
  title: string;
  date: string;
  source: string;
  duration: number; // seconds
  videoType: string;
  speakers: string[];
}

/**
 * Format seconds into human-readable "Xm Ys" string.
 */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

/**
 * Escape a string value for use inside double-quoted YAML scalars.
 * Escapes backslashes first, then double quotes.
 */
function escapeYamlDoubleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Derive Obsidian tags from video type.
 */
function tagsForVideoType(videoType: string): string[] {
  if (videoType === 'coding') return ['video', 'coding-tutorial'];
  if (videoType === 'meeting') return ['video', 'meeting'];
  return ['video'];
}

/**
 * Prepend a YAML frontmatter block to the given markdown content.
 */
export function addYamlFrontmatter(content: string, metadata: ObsidianMetadata): string {
  const { title, date, source, duration, videoType, speakers } = metadata;
  const tags = tagsForVideoType(videoType);

  const tagsYaml = tags.map((t) => `  - ${t}`).join('\n');
  const speakersYaml =
    speakers.length > 0 ? speakers.map((s) => `  - "${escapeYamlDoubleQuoted(s)}"`).join('\n') : '';

  const frontmatter = [
    '---',
    `title: "${escapeYamlDoubleQuoted(title)}"`,
    `date: ${date}`,
    `source: "${escapeYamlDoubleQuoted(source)}"`,
    `duration: "${formatDuration(duration)}"`,
    ...(speakersYaml !== ''
      ? [`speakers:\n${speakersYaml}`]
      : []),
    `tags:\n${tagsYaml}`,
    '---',
  ].join('\n');

  return `${frontmatter}\n${content}`;
}

/**
 * Replace standard markdown links to files in `filesGenerated` with Obsidian wikilinks.
 * External URLs (http://, https://) are left unchanged.
 * .md files: [[filename]] (extension stripped)
 * Other files: [[path/to/file.ext]] (extension kept)
 */
export function addWikilinks(content: string, filesGenerated: string[]): string {
  if (filesGenerated.length === 0) return content;

  const fileSet = new Set(filesGenerated);

  // Match [any text](filename) where filename is NOT an external URL
  // We process each match and replace only if the filename is in filesGenerated
  return content.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (match, _text, href) => {
    // Leave external URLs unchanged
    if (/^https?:\/\//i.test(href)) return match;

    if (!fileSet.has(href)) return match;

    // Strip .md extension for Obsidian wikilinks
    const wikiTarget = href.endsWith('.md') ? href.slice(0, -3) : href;
    return `[[${wikiTarget}]]`;
  });
}
