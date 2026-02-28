import type { SegmentResult, SynthesisResult, MeetingNotesActionItem, TaskAssigned } from '../types/index.js';

export interface WriteActionItemsParams {
  segments: SegmentResult[];
  synthesisResult?: SynthesisResult | null;
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

function renderSynthesisItems(items: MeetingNotesActionItem[]): string[] {
  if (items.length === 0) return [];
  const lines: string[] = ['## From Synthesis', ''];
  for (const a of items) {
    const by = a.mentioned_by.length > 0 ? ` — _${a.mentioned_by}_` : '';
    lines.push(`- [ ] **[${a.timestamp}]** ${a.item}${by}`);
  }
  lines.push('');
  return lines;
}

function renderAssignedTasks(tasks: TaskAssigned[]): string[] {
  if (tasks.length === 0) return [];
  const lines: string[] = ['## Assigned Tasks', ''];
  for (const t of tasks) {
    const assignee = t.assignee.length > 0 ? ` → _${t.assignee}_` : '';
    const deadline = t.deadline.length > 0 ? ` (due: ${t.deadline})` : '';
    lines.push(`- [ ] **[${t.timestamp}]** ${t.task}${assignee}${deadline}`);
  }
  lines.push('');
  return lines;
}

export function writeActionItems(params: WriteActionItemsParams): string | null {
  const { segments, synthesisResult } = params;

  const synthesisItems = synthesisResult?.action_items ?? [];
  const assignedTasks = collectTasksAssigned(segments);

  if (synthesisItems.length === 0 && assignedTasks.length === 0) return null;

  const sections: string[] = ['# Action Items', ''];

  sections.push(...renderSynthesisItems(synthesisItems));
  sections.push(...renderAssignedTasks(assignedTasks));

  // Trim trailing blank lines
  while (sections[sections.length - 1] === '') sections.pop();

  return sections.join('\n');
}
