import type { SegmentResult, SynthesisResult, MeetingNotesActionItem, TaskAssigned, SpeakerMapping } from '../types/index.js';
import { applySpeakerMapping } from '../lib/utils.js';

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
    lines.push(`- [ ] **[${a.timestamp}]** ${a.item}${by}`);
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
    lines.push(`- [ ] **[${t.timestamp}]** ${t.task}${assigneeStr}${deadline}`);
  }
  lines.push('');
  return lines;
}

export function writeActionItems(params: WriteActionItemsParams): string | null {
  const { segments, synthesisResult, speakerMapping } = params;

  const synthesisItems = synthesisResult?.action_items ?? [];
  const assignedTasks = collectTasksAssigned(segments);

  if (synthesisItems.length === 0 && assignedTasks.length === 0) return null;

  const sections: string[] = ['# Action Items', ''];

  sections.push(...renderSynthesisItems(synthesisItems, speakerMapping));
  sections.push(...renderAssignedTasks(assignedTasks, speakerMapping));

  // Trim trailing blank lines
  while (sections[sections.length - 1] === '') sections.pop();

  return sections.join('\n');
}
