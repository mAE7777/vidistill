import type { SegmentResult, ExtractedLink } from '../types/index.js';

export interface WriteLinksParams {
  segments: SegmentResult[];
}

interface CategorizedLink extends ExtractedLink {
  category: string;
}

const URL_OR_DOMAIN_REGEX = /(?:https?:\/\/|www\.)[^\s)<>"\\]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)<>"\\]*)?/gi;
const TRAILING_PUNCT = /[.,;:!?)]+$/;
const COMMON_BARE_DOMAIN_TLDS = new Set([
  'ai',
  'app',
  'co',
  'com',
  'dev',
  'edu',
  'gov',
  'io',
  'ly',
  'me',
  'net',
  'org',
  'studio',
  'tv',
  'uk',
  'us',
]);

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

function normalizeOutputUrl(url: string): string {
  const trimmed = url.replace(TRAILING_PUNCT, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function dedupeKey(url: string): string {
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

function extractUrlsFromText(text: string): string[] {
  const urls: string[] = [];
  for (const match of text.matchAll(URL_OR_DOMAIN_REGEX)) {
    const raw = match[0];
    const prev = match.index != null && match.index > 0 ? text[match.index - 1] : '';
    const hasProtocolOrWww = /^(https?:\/\/|www\.)/i.test(raw);
    if (!hasProtocolOrWww && prev === '@') continue;
    if (!hasProtocolOrWww) {
      const host = raw.split('/')[0].toLowerCase();
      const tld = host.split('.').pop() ?? '';
      if (!COMMON_BARE_DOMAIN_TLDS.has(tld)) continue;
    }
    urls.push(normalizeOutputUrl(raw));
  }
  return urls;
}

export function scanTranscriptForUrls(segments: SegmentResult[]): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  for (const seg of segments) {
    if (seg.pass1 == null) continue;
    for (const entry of seg.pass1.transcript_entries) {
      for (const url of extractUrlsFromText(entry.text)) {
        links.push({ url, context: '', timestamp: entry.timestamp });
      }
    }
  }
  return links;
}

export function scanChatMessagesForUrls(segments: SegmentResult[]): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  for (const seg of segments) {
    if (seg.pass3c == null) continue;
    for (const message of seg.pass3c.messages ?? []) {
      for (const url of extractUrlsFromText(message.text)) {
        links.push({
          url,
          context: `Visible chat message from ${message.sender}`,
          timestamp: message.timestamp,
        });
      }
    }
  }
  return links;
}

function collectAllLinks(segments: SegmentResult[]): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  for (const seg of segments) {
    if (seg.pass3c != null) {
      links.push(...seg.pass3c.links.map((link) => ({ ...link, url: normalizeOutputUrl(link.url) })));
    }
  }
  return links;
}

function deduplicateLinks(links: ExtractedLink[]): ExtractedLink[] {
  const seen = new Set<string>();
  return links.filter((l) => {
    const key = dedupeKey(l.url);
    if (seen.has(key)) return false;
    seen.add(key);
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
  const rawLinks = [...collectAllLinks(segments), ...scanChatMessagesForUrls(segments), ...scanTranscriptForUrls(segments)];
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
