import figlet from 'figlet';
import pc from 'picocolors';
import { intro, log } from '@clack/prompts';

export function showLogo(): void {
  const ascii = figlet.textSync('VIDISTILL', { font: 'Big' });
  console.log(pc.cyan(ascii));
}

export function showIntro(): void {
  intro(pc.dim('video intelligence distiller'));
}

export function showConfig(config: {
  input: string;
  context: string | undefined;
  output: string;
}): void {
  const lines = [
    `  input   ${pc.cyan(config.input)}`,
    `  context ${config.context ? pc.white(config.context) : pc.dim('(none)')}`,
    `  output  ${pc.white(config.output)}`,
  ];
  log.message(lines.join('\n'), { symbol: pc.green('»') });
}
