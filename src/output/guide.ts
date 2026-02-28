import { formatDuration } from '../lib/utils.js';
import type { PipelineResult, VideoProfile, SynthesisResult } from '../types/index.js';

export interface WriteGuideParams {
  title: string;
  source: string;
  duration: number;
  pipelineResult: PipelineResult;
}

function renderFilesTable(synthesisResult: SynthesisResult | undefined): string {
  if (synthesisResult == null || synthesisResult.files_to_generate.length === 0) {
    return '_No files identified._';
  }
  const rows = synthesisResult.files_to_generate.map((f) => `| ${f} |`).join('\n');
  return `| File |\n|------|\n${rows}`;
}

function renderSuggestions(synthesisResult: SynthesisResult | undefined): string {
  if (synthesisResult == null || synthesisResult.suggestions.length === 0) {
    return '_No suggestions._';
  }
  return synthesisResult.suggestions.map((s) => `- ${s}`).join('\n');
}

function renderVideoType(profile: VideoProfile | undefined): string {
  if (profile == null) return 'unknown';
  return profile.type;
}

function renderProcessingDetails(pipelineResult: PipelineResult): string {
  const { passesRun, videoProfile, strategy } = pipelineResult;
  const lines: string[] = [];
  lines.push(`- **Passes run:** ${passesRun.length > 0 ? passesRun.join(', ') : 'none'}`);
  if (videoProfile != null) {
    lines.push(`- **Complexity:** ${videoProfile.complexity}`);
    lines.push(`- **Speakers detected:** ${videoProfile.speakers.count}`);
    if (videoProfile.speakers.identified.length > 0) {
      lines.push(`- **Identified speakers:** ${videoProfile.speakers.identified.join(', ')}`);
    }
  }
  if (strategy != null) {
    lines.push(`- **Resolution:** ${strategy.resolution}`);
    lines.push(`- **Segment length:** ${strategy.segmentMinutes} min`);
  }
  lines.push(`- **Segments processed:** ${pipelineResult.segments.length}`);
  return lines.join('\n');
}

function renderIncompletePasses(pipelineResult: PipelineResult): string {
  const { errors, interrupted } = pipelineResult;
  const hasErrors = errors.length > 0;
  const hasInterruption = interrupted != null && interrupted.length > 0;

  if (!hasErrors && !hasInterruption) return '';

  const lines: string[] = ['', '## Incomplete Passes', ''];

  if (hasInterruption && interrupted != null) {
    lines.push(`> Processing interrupted — passes incomplete: ${interrupted.join(', ')}`);
    lines.push('');
  }

  if (hasErrors) {
    lines.push('_The following passes encountered errors:_');
    lines.push('');
    for (const err of errors) {
      lines.push(`- ${err}`);
    }
  }

  return lines.join('\n');
}

export function writeGuide(params: WriteGuideParams): string {
  const { title, source, duration, pipelineResult } = params;
  const { synthesisResult, videoProfile } = pipelineResult;

  const overview = synthesisResult?.overview ?? '_No summary available — synthesis pass did not run or produced no output._';
  const videoType = renderVideoType(videoProfile);

  const sections: string[] = [
    `# ${title}`,
    '',
    '## Source',
    '',
    `- **File/URL:** ${source}`,
    `- **Duration:** ${formatDuration(duration)}`,
    `- **Type:** ${videoType}`,
    '',
    '## Files',
    '',
    renderFilesTable(synthesisResult),
    '',
    '## Summary',
    '',
    overview,
    '',
    '## Suggestions',
    '',
    renderSuggestions(synthesisResult),
    '',
    '## Processing Details',
    '',
    renderProcessingDetails(pipelineResult),
    renderIncompletePasses(pipelineResult),
  ];

  return sections.join('\n');
}
