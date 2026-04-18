import type { SegmentResult, ExtractedLink } from '../types/index.js';

export interface WriteLinksParams {
  segments: SegmentResult[];
}

interface CategorizedLink extends ExtractedLink {
  category: string;
}

const URL_REGEX = /https?:\/\/[^\s)<>"\\]+/g;
const TRAILING_PUNCT = /[.,;:!?)+]+$/;

const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /github\.com/i, category: 'GitHub' },
  { pattern: /npmjs\.com|npm\.im/i, category: 'npm' },
  { pattern: /docs\.|documentation\.|developer\.|developers\./i, category: 'Documentation' },
  { pattern: /youtube\.com|youtu\.be/i, category: 'Video' },
  { pattern: /stackoverflow\.com|stackexchange\.com/i, category: 'Stack Overflow' },
  { pattern: /twitter\.com|x\.com/i, category: 'Twitter/X' },
  { pattern: /linkedin\.com/i, category: 'LinkedIn' },
  { pattern: /medium\.com|dev\.to|hashnode\.|substack\./i, category: 'Articles' },
];

const DEFAULT_CATEGORY = 'Other';

function categorizeUrl(url: string): string {
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(url)) return category;
  }
  return DEFAULT_CATEGORY;
}

export function scanTranscriptForUrls(segments: SegmentResult[]): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  for (const seg of segments) {
    if (seg.pass1 == null) continue;
    for (const entry of seg.pass1.transcript_entries) {
      const matches = entry.text.match(URL_REGEX);
      if (matches == null) continue;
      for (const raw of matches) {
        const url = raw.replace(TRAILING_PUNCT, '');
        links.push({ url, context: '', timestamp: entry.timestamp });
      }
    }
  }
  return links;
}

function collectAllLinks(segments: SegmentResult[]): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  for (const seg of segments) {
    if (seg.pass3c != null) {
      links.push(...seg.pass3c.links);
    }
  }
  return links;
}

function deduplicateLinks(links: ExtractedLink[]): ExtractedLink[] {
  const seen = new Set<string>();
  return links.filter((l) => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
}

function groupByCategory(links: CategorizedLink[]): Map<string, CategorizedLink[]> {
  const map = new Map<string, CategorizedLink[]>();
  for (const link of links) {
    const group = map.get(link.category) ?? [];
    group.push(link);
    map.set(link.category, group);
  }
  return map;
}

export function writeLinks(params: WriteLinksParams): string | null {
  const { segments } = params;

  // pass3c links first (they have context), then transcript-scanned links as fallback
  const rawLinks = [...collectAllLinks(segments), ...scanTranscriptForUrls(segments)];
  if (rawLinks.length === 0) return null;

  const deduped = deduplicateLinks(rawLinks);
  const categorized: CategorizedLink[] = deduped.map((l) => ({
    ...l,
    category: categorizeUrl(l.url),
  }));

  const grouped = groupByCategory(categorized);

  const sections: string[] = ['# Links', ''];

  // Sort categories: put 'Other' last
  const sortedCategories = [...grouped.keys()].sort((a, b) => {
    if (a === DEFAULT_CATEGORY) return 1;
    if (b === DEFAULT_CATEGORY) return -1;
    return a.localeCompare(b);
  });

  for (const category of sortedCategories) {
    const links = grouped.get(category) ?? [];
    sections.push(`## ${category}`, '');
    for (const l of links) {
      const ctx = l.context.length > 0 ? ` — ${l.context}` : '';
      sections.push(`- **[${l.timestamp}]** <${l.url}>${ctx}`);
    }
    sections.push('');
  }

  // Trim trailing blank lines
  while (sections[sections.length - 1] === '') sections.pop();

  return sections.join('\n');
}
