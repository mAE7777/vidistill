import type { Pass2Result, VisualRegion } from '../types/index.js';

const CHAT_REGION_TYPES = new Set(['chat', 'comment_panel', 'sidebar']);

const CHAT_TEXT_PATTERNS = [
  /\bchat\b/i,
  /\bchatbox\b/i,
  /\bmessage[s]?\b/i,
  /\bcomment[s]?\b/i,
  /\bcomment panel\b/i,
  /\bcomment sidebar\b/i,
  /\bconversation\b/i,
  /\bjoin the conversation\b/i,
  /\blive conversation[s]?\b/i,
  /\bsession chat[s]?\b/i,
  /\bquestion[s]?\s+from\b/i,
  /\baudience question[s]?\b/i,
  /\bsidebar\b/i,
];

export function isChatRegionType(regionType?: string): boolean {
  return regionType != null && CHAT_REGION_TYPES.has(regionType);
}

function hasChatText(value?: string): boolean {
  if (value == null || value.trim() === '') return false;
  return CHAT_TEXT_PATTERNS.some((pattern) => pattern.test(value));
}

function regionText(region: VisualRegion): string {
  return [
    region.region_type,
    region.label,
    region.sample_text,
  ].filter(Boolean).join(' ');
}

export function pass2HasChatCandidate(pass2?: Pass2Result | null): boolean {
  if (pass2 == null) return false;

  for (const region of pass2.visual_regions ?? []) {
    if (isChatRegionType(region.region_type)) return true;
    if (hasChatText(regionText(region))) return true;
  }

  for (const note of pass2.visual_notes ?? []) {
    if (hasChatText(`${note.visual_type} ${note.description}`)) return true;
  }

  for (const entry of pass2.screen_timeline ?? []) {
    if (hasChatText(entry.screen_state)) return true;
  }

  return false;
}

export function collectChatCandidateDescriptions(pass2?: Pass2Result | null): string[] {
  if (pass2 == null) return [];
  const descriptions: string[] = [];

  for (const region of pass2.visual_regions ?? []) {
    if (isChatRegionType(region.region_type) || hasChatText(regionText(region))) {
      descriptions.push(`${region.timestamp} ${region.region_type}: ${region.label || region.sample_text}`);
    }
  }

  for (const note of pass2.visual_notes ?? []) {
    if (hasChatText(`${note.visual_type} ${note.description}`)) {
      descriptions.push(`${note.timestamp} ${note.visual_type}: ${note.description}`);
    }
  }

  for (const entry of pass2.screen_timeline ?? []) {
    if (hasChatText(entry.screen_state)) {
      descriptions.push(`${entry.timestamp}: ${entry.screen_state}`);
    }
  }

  return descriptions;
}
