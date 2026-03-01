import { createRequire } from 'node:module';
import { defineCommand, runMain } from 'citty';
import { showLogo, showIntro } from './ui.js';
import { runDistill } from '../commands/distill.js';
import { run as runAsk } from '../commands/ask.js';
import { run as runSearch } from '../commands/search.js';
import { run as runMcp } from '../commands/mcp.js';
import { run as runWatch } from '../commands/watch.js';
import { run as runRenameSpeakers } from '../commands/rename-speakers.js';

const _require = createRequire(import.meta.url);
const { version } = _require('../package.json') as { version: string };

const DEFAULT_OUTPUT = './vidistill-output/';

const SUBCOMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  ask: runAsk,
  search: runSearch,
  mcp: runMcp,
  watch: runWatch,
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
  },
  async run({ args }) {
    showLogo();
    showIntro();

    const name = args.input;

    if (name != null && name in SUBCOMMANDS) {
      await SUBCOMMANDS[name](process.argv.slice(3));
      return;
    }

    try {
      await runDistill({
        input: args.input,
        context: args.context,
        output: args.output,
        lang: args.lang,
      });
    } catch (err) {
      const { log } = await import('@clack/prompts');
      const { default: pc } = await import('picocolors');
      const raw = err instanceof Error ? err.message : String(err);
      const message = raw.split('\n')[0].slice(0, 200);
      log.error(pc.red(message));
      process.exit(1);
    }
  },
});

runMain(main);
