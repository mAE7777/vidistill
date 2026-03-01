import figlet from 'figlet';
import pc from 'picocolors';
import { intro, note } from '@clack/prompts';

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
}): void {
  const lines = [
    `Video:   ${config.input}`,
    `Context: ${config.context ?? '(none)'}`,
    `Output:  ${config.output}`,
  ];
  note(lines.join('\n'), 'Configuration');
}
