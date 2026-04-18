import { defineCommand, runMain } from 'citty';
import { existsSync } from 'fs';
import { showLogo, showIntro } from './ui.js';
import { runDistill } from '../commands/distill.js';
import { run as runMcp } from '../commands/mcp.js';
import { run as runRenameSpeakers } from '../commands/rename-speakers.js';

declare const VIDISTILL_VERSION: string;
const version = VIDISTILL_VERSION;

const DEFAULT_OUTPUT = './vidistill-output/';

const SUBCOMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  mcp: runMcp,
  'rename-speakers': runRenameSpeakers,
};

const main = defineCommand({
  meta: {
    name: 'vidistill',
    version,
    description: `Video Intelligence Distiller — turn video into structured notes\n\nCommands: ${Object.keys(SUBCOMMANDS).join(', ')}`,
  },
  args: {
    input: {
      type: 'positional',
      description: 'YouTube URL, local file path, or subcommand name',
      required: false,
    },
    context: {
      type: 'string',
      description: 'Optional context about the video (e.g. "CS lecture", "product demo")',
      alias: 'c',
    },
    output: {
      type: 'string',
      description: `Output directory for generated notes (default: ${DEFAULT_OUTPUT})`,
      alias: 'o',
      default: DEFAULT_OUTPUT,
    },
    lang: {
      type: 'string',
      description: 'Output language',
      alias: 'l',
    },
    batch: {
      type: 'string',
      description: 'Path to a batch file containing URLs/paths to process',
      alias: 'b',
    },
  },
  async run({ args }) {
    const name = args.input;

    if (name != null && name in SUBCOMMANDS) {
      await SUBCOMMANDS[name](process.argv.slice(3));
      return;
    }

    const { log } = await import('@clack/prompts');
    const { default: pc } = await import('picocolors');

    if (args.batch != null && args.input != null) {
      log.error('--batch and a positional input URL are mutually exclusive. Use one or the other.');
      process.exit(1);
    }

    if (args.batch != null && !existsSync(args.batch)) {
      log.error(`Batch file not found: ${args.batch}`);
      process.exit(1);
    }

    showLogo();
    showIntro();

    try {
      await runDistill({
        input: args.input,
        context: args.context,
        output: args.output,
        lang: args.lang,
        batch: args.batch,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const message = raw.split('\n')[0].slice(0, 200);
      log.error(pc.red(message));
      process.exit(1);
    }
  },
});

runMain(main);
