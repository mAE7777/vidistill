import type { GeminiClient } from '../gemini/client.js';
import { SYSTEM_INSTRUCTION_SYNTHESIS } from '../constants/prompts.js';
import { SCHEMA_SYNTHESIS } from '../gemini/schemas.js';
import type {
  SegmentResult,
  VideoProfile,
  PeopleExtraction,
  SynthesisResult,
} from '../types/index.js';

export interface RunSynthesisParams {
  client: GeminiClient;
  model: string;
  segmentResults: SegmentResult[];
  videoProfile: VideoProfile;
  peopleExtraction?: PeopleExtraction | null;
  context?: string;
}

function compileContext(params: RunSynthesisParams): string {
  const { segmentResults, videoProfile, peopleExtraction, context } = params;

  const segmentSections = segmentResults.map((seg, idx) => {
    const segNum = idx + 1;
    const pass1 = seg.pass1;
    const pass2 = seg.pass2;
    const pass3a = seg.pass3a;
    const pass3c = seg.pass3c;
    const pass3d = seg.pass3d;

    const timeRange = pass1?.time_range ?? pass2?.time_range ?? `segment ${segNum}`;
    const lines: string[] = [`=== SEGMENT ${segNum} (${timeRange}) ===`, ''];

    // Transcript
    lines.push('--- Transcript ---');
    if (pass1 != null && pass1.transcript_entries.length > 0) {
      for (const t of pass1.transcript_entries) {
        lines.push(`[${t.timestamp}] ${t.speaker}: ${t.text}`);
      }
    } else {
      lines.push('[No transcript available]');
    }
    lines.push('');

    // Code Blocks
    lines.push('--- Code Blocks ---');
    if (pass2 != null && pass2.code_blocks.length > 0) {
      for (const b of pass2.code_blocks) {
        lines.push(`[${b.timestamp}] ${b.filename} (${b.language}):`);
        lines.push(b.content);
      }
    } else {
      lines.push('[No code blocks]');
    }
    lines.push('');

    // Visual Notes
    lines.push('--- Visual Notes ---');
    if (pass2 != null && pass2.visual_notes.length > 0) {
      for (const n of pass2.visual_notes) {
        lines.push(`[${n.timestamp}] ${n.visual_type}: ${n.description}`);
      }
    } else {
      lines.push('[No visual notes]');
    }
    lines.push('');

    // Code Reconstruction (pass3a)
    if (pass3a != null) {
      lines.push('--- Code Reconstruction ---');
      for (const f of pass3a.files) {
        lines.push(`File: ${f.filename} (${f.language})`);
        lines.push(`Final content: ${f.final_content}`);
      }
      lines.push('');
    }

    // Chat Messages (pass3c)
    if (pass3c != null) {
      lines.push('--- Chat Messages ---');
      if (pass3c.messages.length > 0) {
        for (const m of pass3c.messages) {
          lines.push(`[${m.timestamp}] ${m.sender}: ${m.text}`);
        }
      } else {
        lines.push('[No chat messages]');
      }
      lines.push('');
    }

    // Implicit Signals (pass3d)
    if (pass3d != null) {
      lines.push('--- Implicit Signals ---');
      if (pass3d.emotional_shifts.length > 0) {
        lines.push(
          `Emotional shifts: ${pass3d.emotional_shifts.map((s) => `[${s.timestamp}] ${s.from_state} → ${s.to_state} (${s.trigger})`).join('; ')}`,
        );
      }
      if (pass3d.tasks_assigned.length > 0) {
        lines.push(
          `Tasks assigned: ${pass3d.tasks_assigned.map((t) => `[${t.timestamp}] ${t.assignee}: ${t.task}`).join('; ')}`,
        );
      }
      lines.push('');
    }

    return lines.join('\n');
  });

  // Video Profile summary
  const profileLines: string[] = [
    '=== VIDEO PROFILE ===',
    `Type: ${videoProfile.type} | Complexity: ${videoProfile.complexity} | Speakers: ${videoProfile.speakers.count}`,
  ];

  // People
  const peopleLines: string[] = ['=== PEOPLE ==='];
  if (peopleExtraction != null && peopleExtraction.participants.length > 0) {
    for (const p of peopleExtraction.participants) {
      const orgPart = p.organization ? `, ${p.organization}` : '';
      peopleLines.push(`- ${p.name} (${p.role}${orgPart})`);
    }
  } else {
    peopleLines.push('[No people data]');
  }

  // User context
  const contextLines: string[] = ['=== USER CONTEXT ===', context != null && context.length > 0 ? context : '[No user context provided]'];

  return [
    ...segmentSections,
    profileLines.join('\n'),
    peopleLines.join('\n'),
    contextLines.join('\n'),
  ].join('\n\n');
}

export async function runSynthesis(params: RunSynthesisParams): Promise<SynthesisResult> {
  const { client, model } = params;

  const compiledContext = compileContext(params);

  const contents = [
    {
      role: 'user' as const,
      parts: [{ text: compiledContext }],
    },
  ];

  const result = await client.generate({
    model,
    contents,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION_SYNTHESIS,
      responseSchema: SCHEMA_SYNTHESIS,
      responseMimeType: 'application/json',
      maxOutputTokens: 65536,
      temperature: 1.0,
    },
  });

  if (
    result === null ||
    typeof result !== 'object' ||
    typeof (result as Record<string, unknown>)['overview'] !== 'string' ||
    !Array.isArray((result as Record<string, unknown>)['files_to_generate']) ||
    !Array.isArray((result as Record<string, unknown>)['key_decisions']) ||
    !Array.isArray((result as Record<string, unknown>)['key_concepts']) ||
    !Array.isArray((result as Record<string, unknown>)['action_items']) ||
    !Array.isArray((result as Record<string, unknown>)['questions_raised']) ||
    !Array.isArray((result as Record<string, unknown>)['suggestions']) ||
    !Array.isArray((result as Record<string, unknown>)['topics'])
  ) {
    throw new Error('Incomplete SynthesisResult from Gemini synthesis');
  }

  return result as SynthesisResult;
}
