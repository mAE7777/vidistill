import { formatDuration, applySpeakerMapping, replaceNamesInText } from '../lib/utils.js';
import type { PipelineResult, VideoProfile, SynthesisResult, SpeakerMapping } from '../types/index.js';

export interface WriteGuideParams {
  title: string;
  source: string;
  duration: number;
  pipelineResult: PipelineResult;
  filesGenerated?: string[];
  speakerMapping?: SpeakerMapping;
}

function renderFilesTable(filesGenerated: string[] | undefined): string {
  if (filesGenerated == null || filesGenerated.length === 0) {
    return '_No files generated._';
  }
  // Exclude internal files from the table
  const exclude = new Set(['metadata.json', 'guide.md']);
  const visible = filesGenerated.filter((f) => !exclude.has(f) && !f.startsWith('raw/'));
  if (visible.length === 0) {
    return '_No files generated._';
  }
  const rows = visible.map((f) => `| ${f} |`).join('\n');
  return `| File |\n|------|\n${rows}`;
}

function renderSuggestions(synthesisResult: SynthesisResult | undefined, speakerMapping?: SpeakerMapping): string {
  if (synthesisResult == null || synthesisResult.suggestions.length === 0) {
    return '_No suggestions._';
  }
  return synthesisResult.suggestions.map((s) => `- ${replaceNamesInText(s, speakerMapping)}`).join('\n');
}

function renderVideoType(profile: VideoProfile | undefined): string {
  if (profile == null) return 'unknown';
  return profile.type;
}

function renderProcessingDetails(pipelineResult: PipelineResult, speakerMapping?: SpeakerMapping): string {
  const { passesRun, videoProfile, strategy } = pipelineResult;
  const lines: string[] = [];
  lines.push(`- **Passes run:** ${passesRun.length > 0 ? passesRun.join(', ') : 'none'}`);
  if (videoProfile != null) {
    lines.push(`- **Complexity:** ${videoProfile.complexity}`);
    lines.push(`- **Speakers detected:** ${videoProfile.speakers.count}`);
    if (videoProfile.speakers.identified.length > 0) {
      const identified = videoProfile.speakers.identified.map((s) => applySpeakerMapping(s, speakerMapping));
      lines.push(`- **Identified speakers:** ${identified.join(', ')}`);
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
  const { title, source, duration, pipelineResult, filesGenerated, speakerMapping } = params;
  const { synthesisResult, videoProfile } = pipelineResult;

  const rawOverview = synthesisResult?.overview ?? '_No summary available — synthesis pass did not run or produced no output._';
  const overview = replaceNamesInText(rawOverview, speakerMapping);
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
    renderFilesTable(filesGenerated),
    '',
    '## Summary',
    '',
    overview,
    '',
    '## Suggestions',
    '',
    renderSuggestions(synthesisResult, speakerMapping),
    '',
    '## Processing Details',
    '',
    renderProcessingDetails(pipelineResult, speakerMapping),
    renderIncompletePasses(pipelineResult),
  ];

  return sections.join('\n');
}
