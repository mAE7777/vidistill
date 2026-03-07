import type { SegmentResult, SynthesisResult, MeetingNotesActionItem, TaskAssigned, SpeakerMapping } from '../types/index.js';
import { applySpeakerMapping, replaceNamesInText, parseTimestamp } from '../lib/utils.js';
import { tokenOverlap } from '../core/consensus.js';

export interface WriteActionItemsParams {
  segments: SegmentResult[];
  synthesisResult?: SynthesisResult | null;
  speakerMapping?: SpeakerMapping;
}

function collectTasksAssigned(segments: SegmentResult[]): TaskAssigned[] {
  const tasks: TaskAssigned[] = [];
  for (const seg of segments) {
    if (seg.pass3d != null) {
      tasks.push(...seg.pass3d.tasks_assigned);
    }
  }
  return tasks;
}

function renderSynthesisItems(items: MeetingNotesActionItem[], speakerMapping?: SpeakerMapping): string[] {
  if (items.length === 0) return [];
  const lines: string[] = ['## From Synthesis', ''];
  for (const a of items) {
    const mentionedBy = applySpeakerMapping(a.mentioned_by, speakerMapping);
    const by = mentionedBy.length > 0 ? ` — _${mentionedBy}_` : '';
    lines.push(`- [ ] **[${a.timestamp}]** ${replaceNamesInText(a.item, speakerMapping)}${by}`);
  }
  lines.push('');
  return lines;
}

function renderAssignedTasks(tasks: TaskAssigned[], speakerMapping?: SpeakerMapping): string[] {
  if (tasks.length === 0) return [];
  const lines: string[] = ['## Assigned Tasks', ''];
  for (const t of tasks) {
    const assignee = applySpeakerMapping(t.assignee, speakerMapping);
    const assigneeStr = assignee.length > 0 ? ` → _${assignee}_` : '';
    const deadline = t.deadline.length > 0 ? ` (due: ${t.deadline})` : '';
    lines.push(`- [ ] **[${t.timestamp}]** ${replaceNamesInText(t.task, speakerMapping)}${assigneeStr}${deadline}`);
  }
  lines.push('');
  return lines;
}

function isDuplicateTask(task: TaskAssigned, synthesisItems: MeetingNotesActionItem[]): boolean {
  for (const item of synthesisItems) {
    const tsDelta = Math.abs(parseTimestamp(task.timestamp) - parseTimestamp(item.timestamp));
    if (tsDelta > 120) continue;
    const shared = tokenOverlap(task.task, item.item);
    const minLen = Math.min(task.task.split(/\s+/).length, item.item.split(/\s+/).length);
    if (minLen > 0 && shared / minLen >= 0.6) return true;
  }
  return false;
}

export function writeActionItems(params: WriteActionItemsParams): string | null {
  const { segments, synthesisResult, speakerMapping } = params;

  const synthesisItems = synthesisResult?.action_items ?? [];
  const assignedTasks = collectTasksAssigned(segments);

  if (synthesisItems.length === 0 && assignedTasks.length === 0) return null;

  // Filter assigned tasks that duplicate synthesis items
  const dedupedTasks = synthesisItems.length > 0
    ? assignedTasks.filter(t => !isDuplicateTask(t, synthesisItems))
    : assignedTasks;

  const sections: string[] = ['# Action Items', ''];

  sections.push(...renderSynthesisItems(synthesisItems, speakerMapping));
  sections.push(...renderAssignedTasks(dedupedTasks, speakerMapping));

  // Trim trailing blank lines
  while (sections[sections.length - 1] === '') sections.pop();

  return sections.join('\n');
}
