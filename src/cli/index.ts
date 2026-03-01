import { defineCommand, runMain } from 'citty';
import { showLogo, showIntro } from './ui.js';
import { runDistill } from '../commands/distill.js';

const DEFAULT_OUTPUT = './vidistill-output/';

const SUBCOMMANDS = new Set(['ask', 'search', 'extract', 'mcp', 'watch', 'rename-speakers']);

const main = defineCommand({
  meta: {
    name: 'vidistill',
    description:
      'Video Intelligence Distiller — turn video into structured notes\n\nCommands: ask, search, extract, mcp, watch, rename-speakers',
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

    if (name != null && SUBCOMMANDS.has(name)) {
      const mod = await import(`../commands/${name}.js`);
      if (typeof mod.run !== 'function') {
        throw new Error(`Subcommand "${name}" does not export a run function`);
      }
      await mod.run(process.argv.slice(3));
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
