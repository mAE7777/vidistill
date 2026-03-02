import type { SegmentResult, ChatMessage, ExtractedLink, SpeakerMapping } from '../types/index.js';
import { applySpeakerMapping } from '../lib/utils.js';

export interface WriteChatParams {
  segments: SegmentResult[];
  speakerMapping?: SpeakerMapping;
}

function collectMessages(segments: SegmentResult[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const seg of segments) {
    if (seg.pass3c != null) {
      messages.push(...seg.pass3c.messages);
    }
  }
  return messages;
}

function collectLinks(segments: SegmentResult[]): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  for (const seg of segments) {
    if (seg.pass3c != null) {
      links.push(...seg.pass3c.links);
    }
  }
  return links;
}

function renderMessages(messages: ChatMessage[], speakerMapping?: SpeakerMapping): string[] {
  if (messages.length === 0) return [];
  const lines: string[] = ['## Chat Log', ''];
  for (const m of messages) {
    const sender = applySpeakerMapping(m.sender, speakerMapping);
    lines.push(`**[${m.timestamp}]** **${sender}:** ${m.text}`);
  }
  lines.push('');
  return lines;
}

function renderLinks(links: ExtractedLink[]): string[] {
  if (links.length === 0) return [];
  // Deduplicate by URL
  const seen = new Set<string>();
  const deduped = links.filter((l) => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
  const lines: string[] = ['## Links Shared in Chat', ''];
  for (const l of deduped) {
    const ctx = l.context.length > 0 ? ` — ${l.context}` : '';
    lines.push(`- **[${l.timestamp}]** ${l.url}${ctx}`);
  }
  lines.push('');
  return lines;
}

export function writeChat(params: WriteChatParams): string | null {
  const { segments, speakerMapping } = params;

  const hasChat = segments.some((s) => s.pass3c != null);
  if (!hasChat) return null;

  const messages = collectMessages(segments);
  const links = collectLinks(segments);

  if (messages.length === 0 && links.length === 0) return null;

  const sections: string[] = ['# Chat', ''];

  sections.push(...renderMessages(messages, speakerMapping));
  sections.push(...renderLinks(links));

  // Trim trailing blank lines
  while (sections[sections.length - 1] === '') sections.pop();

  return sections.join('\n');
}
