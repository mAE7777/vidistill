import figlet from 'figlet';
import pc from 'picocolors';
import { intro, note } from '@clack/prompts';
import { LANGUAGE_NAMES } from '../constants/prompts.js';

export function showLogo(): void {
  const ascii = figlet.textSync('VIDISTILL', { font: 'Big' });
  console.log(pc.cyan(ascii));
}

export function showIntro(): void {
  intro(pc.dim('video intelligence distiller'));
}

export function showConfigBox(config: {
  input: string;
  context: string | undefined;
  output: string;
  outputName?: string;
  videoType?: string;
  lang?: string;
  batchFile?: string;
  batchCount?: number;
}): void {
  const lines = config.batchFile != null
    ? [
        `Batch:   ${config.batchFile}`,
        `Items:   ${config.batchCount != null ? String(config.batchCount) : '(unknown)'}`,
        `Output:  ${config.output}`,
      ]
    : [
        `Video:   ${config.input}`,
        `Context: ${config.context ?? '(none)'}`,
        `Name:    ${config.outputName ?? '(auto-detect)'}`,
        `Output:  ${config.output}`,
      ];
  if (config.batchFile == null) {
    if (config.videoType === 'audio') {
      lines.push('Type:    Audio (visual analysis skipped)');
    }
    if (config.lang != null && config.lang !== 'en') {
      const langName = LANGUAGE_NAMES[config.lang] ?? config.lang;
      lines.push(`Language: ${langName} (${config.lang})`);
    }
  }
  note(lines.join('\n'), 'Configuration');
}
