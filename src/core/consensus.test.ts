import { describe, it, expect, vi } from 'vitest';
import { runCodeConsensus, runLinkConsensus } from './consensus.js';
import type { ConsensusConfig } from './consensus.js';
import type { CodeFile, CodeReconstruction, Pass2Result, CodeChange, ChatExtraction, ExtractedLink } from '../types/index.js';

// Factory helpers

function makeCodeChange(overrides: Partial<CodeChange> = {}): CodeChange {
  return {
    timestamp: '00:00:10',
    change_type: 'create',
    description: 'Initial file creation',
    diff_summary: 'Added content',
    ...overrides,
  };
}

function makeCodeFile(overrides: Partial<CodeFile> = {}): CodeFile {
  return {
    filename: 'main.py',
    language: 'python',
    final_content: 'print("hello")',
    changes: [makeCodeChange()],
    ...overrides,
  };
}

function makeCodeReconstruction(files: CodeFile[], overrides: Partial<CodeReconstruction> = {}): CodeReconstruction {
  return {
    files,
    dependencies_mentioned: [],
    build_commands: [],
    ...overrides,
  };
}

function makePass2Result(overrides: Partial<Pass2Result> = {}): Pass2Result {
  return {
    segment_index: 0,
    time_range: '00:00:00 - 00:01:00',
    code_blocks: [],
    visual_notes: [],
    screen_timeline: [],
    ...overrides,
  };
}

const DEFAULT_CONFIG: ConsensusConfig = { runs: 3, minAgreement: 2 };

// Helper to create a runFn that returns results in sequence
function makeRunFn(results: Array<CodeReconstruction | Error>): () => Promise<CodeReconstruction> {
  let callIndex = 0;
  return async () => {
    const result = results[callIndex % results.length];
    callIndex++;
    if (result instanceof Error) throw result;
    return result;
  };
}

describe('runCodeConsensus', () => {
  describe('all runs agree', () => {
    it('puts files appearing in all 3 runs into confirmed list', async () => {
      const file = makeCodeFile({ filename: 'main.py' });
      const run = makeCodeReconstruction([file]);
      const runFn = makeRunFn([run, run, run]);

      const result = await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [],
      });

      expect(result.confirmed).toHaveLength(1);
      expect(result.confirmed[0].filename).toBe('main.py');
      expect(result.rejected).toHaveLength(0);
    });

    it('puts both files into confirmed when both appear in all 3 runs', async () => {
      const mainPy = makeCodeFile({ filename: 'main.py' });
      const appJs = makeCodeFile({ filename: 'app.js', language: 'javascript', final_content: 'const x = 1;' });
      const run = makeCodeReconstruction([mainPy, appJs]);
      const runFn = makeRunFn([run, run, run]);

      const result = await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [],
      });

      const confirmedNames = result.confirmed.map(f => f.filename).sort();
      expect(confirmedNames).toEqual(['app.js', 'main.py']);
      expect(result.rejected).toHaveLength(0);
    });
  });

  describe('partial agreement', () => {
    it('confirms file appearing in 2/3 runs (meets minAgreement=2)', async () => {
      const configTs = makeCodeFile({ filename: 'config.ts', language: 'typescript' });
      const run1 = makeCodeReconstruction([configTs]);
      const run2 = makeCodeReconstruction([configTs]);
      const run3 = makeCodeReconstruction([]);
      const runFn = makeRunFn([run1, run2, run3]);

      const result = await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [],
      });

      expect(result.confirmed).toHaveLength(1);
      expect(result.confirmed[0].filename).toBe('config.ts');
      expect(result.rejected).toHaveLength(0);
    });

    it('rejects file appearing in only 1/3 runs', async () => {
      const utilsPy = makeCodeFile({ filename: 'utils.py' });
      const run1 = makeCodeReconstruction([utilsPy]);
      const run2 = makeCodeReconstruction([]);
      const run3 = makeCodeReconstruction([]);
      const runFn = makeRunFn([run1, run2, run3]);

      const result = await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [],
      });

      expect(result.confirmed).toHaveLength(0);
      expect(result.rejected).toContain('utils.py');
    });

    it('produces one confirmed and one rejected in same consensus run', async () => {
      const mainPy = makeCodeFile({ filename: 'main.py' });
      const utilsPy = makeCodeFile({ filename: 'utils.py' });

      const run1 = makeCodeReconstruction([mainPy, utilsPy]);
      const run2 = makeCodeReconstruction([mainPy]);
      const run3 = makeCodeReconstruction([mainPy]);
      const runFn = makeRunFn([run1, run2, run3]);

      const result = await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [],
      });

      expect(result.confirmed.map(f => f.filename)).toContain('main.py');
      expect(result.rejected).toContain('utils.py');
    });
  });

  describe('filename normalization', () => {
    it('treats ./main.py, Main.py, and main.py as the same file', async () => {
      const file1 = makeCodeFile({ filename: './main.py' });
      const file2 = makeCodeFile({ filename: 'Main.py' });
      const file3 = makeCodeFile({ filename: 'main.py' });

      const run1 = makeCodeReconstruction([file1]);
      const run2 = makeCodeReconstruction([file2]);
      const run3 = makeCodeReconstruction([file3]);
      const runFn = makeRunFn([run1, run2, run3]);

      const result = await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [],
      });

      expect(result.confirmed).toHaveLength(1);
      expect(result.rejected).toHaveLength(0);
    });

    it('normalizes backslash path separators to forward slashes', async () => {
      const file1 = makeCodeFile({ filename: 'src\\utils.py' });
      const file2 = makeCodeFile({ filename: 'src/utils.py' });
      const file3 = makeCodeFile({ filename: 'src/utils.py' });

      const run1 = makeCodeReconstruction([file1]);
      const run2 = makeCodeReconstruction([file2]);
      const run3 = makeCodeReconstruction([file3]);
      const runFn = makeRunFn([run1, run2, run3]);

      const result = await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [],
      });

      expect(result.confirmed).toHaveLength(1);
    });
  });

  describe('content selection', () => {
    it('selects version with highest token overlap against pass2 code_blocks', async () => {
      const pass2 = makePass2Result({
        code_blocks: [
          {
            timestamp: '00:00:10',
            filename: 'main.py',
            language: 'python',
            content: 'def compute(): return 42',
            screen_type: 'code_editor',
            change_type: 'create',
            instructor_explanation: '',
          },
        ],
      });

      // version1 has high overlap with pass2 content
      const version1 = makeCodeFile({
        filename: 'main.py',
        final_content: 'def compute(): return 42',
      });
      // version2 has low overlap
      const version2 = makeCodeFile({
        filename: 'main.py',
        final_content: 'x = y + z',
      });

      const run1 = makeCodeReconstruction([version1]);
      const run2 = makeCodeReconstruction([version2]);
      const run3 = makeCodeReconstruction([version1]);
      const runFn = makeRunFn([run1, run2, run3]);

      const result = await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [pass2],
      });

      expect(result.confirmed).toHaveLength(1);
      expect(result.confirmed[0].final_content).toBe('def compute(): return 42');
    });

    it('uses longest content as tie-break when token overlap scores are equal', async () => {
      // No pass2 results → no reference text, scores by length
      const shortVersion = makeCodeFile({
        filename: 'main.py',
        final_content: 'x = 1',
      });
      const longVersion = makeCodeFile({
        filename: 'main.py',
        final_content: 'x = 1\ny = 2\nz = x + y\nprint(z)',
      });

      const run1 = makeCodeReconstruction([shortVersion]);
      const run2 = makeCodeReconstruction([longVersion]);
      const run3 = makeCodeReconstruction([shortVersion]);
      const runFn = makeRunFn([run1, run2, run3]);

      const result = await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [],
      });

      expect(result.confirmed).toHaveLength(1);
      expect(result.confirmed[0].final_content).toBe(longVersion.final_content);
    });

    it('selects by longest content when no pass2 code blocks match the filename', async () => {
      const pass2 = makePass2Result({
        code_blocks: [
          {
            timestamp: '00:00:10',
            filename: 'other_file.py',
            language: 'python',
            content: 'some other content',
            screen_type: 'code_editor',
            change_type: 'create',
            instructor_explanation: '',
          },
        ],
      });

      const shortVersion = makeCodeFile({ filename: 'main.py', final_content: 'a' });
      const longVersion = makeCodeFile({ filename: 'main.py', final_content: 'a = 1\nb = 2\nc = 3' });

      const run1 = makeCodeReconstruction([shortVersion]);
      const run2 = makeCodeReconstruction([longVersion]);
      const run3 = makeCodeReconstruction([shortVersion]);
      const runFn = makeRunFn([run1, run2, run3]);

      const result = await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [pass2],
      });

      expect(result.confirmed[0].final_content).toBe(longVersion.final_content);
    });
  });

  describe('change history deduplication', () => {
    it('deduplicates changes with same timestamp + change_type', async () => {
      const sharedChange = makeCodeChange({ timestamp: '00:00:10', change_type: 'create' });
      const uniqueChange = makeCodeChange({ timestamp: '00:00:20', change_type: 'modify' });

      const file1 = makeCodeFile({ changes: [sharedChange] });
      const file2 = makeCodeFile({ changes: [sharedChange, uniqueChange] });
      const file3 = makeCodeFile({ changes: [sharedChange] });

      const runFn = makeRunFn([
        makeCodeReconstruction([file1]),
        makeCodeReconstruction([file2]),
        makeCodeReconstruction([file3]),
      ]);

      const result = await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [],
      });

      expect(result.confirmed).toHaveLength(1);
      // sharedChange appears once, uniqueChange appears once = 2 total
      expect(result.confirmed[0].changes).toHaveLength(2);
    });

    it('unions changes with different timestamps', async () => {
      const change1 = makeCodeChange({ timestamp: '00:00:10', change_type: 'create' });
      const change2 = makeCodeChange({ timestamp: '00:00:20', change_type: 'modify' });
      const change3 = makeCodeChange({ timestamp: '00:00:30', change_type: 'modify' });

      const file1 = makeCodeFile({ changes: [change1] });
      const file2 = makeCodeFile({ changes: [change1, change2] });
      const file3 = makeCodeFile({ changes: [change1, change2, change3] });

      const runFn = makeRunFn([
        makeCodeReconstruction([file1]),
        makeCodeReconstruction([file2]),
        makeCodeReconstruction([file3]),
      ]);

      const result = await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [],
      });

      expect(result.confirmed[0].changes).toHaveLength(3);
    });
  });

  describe('metadata merging', () => {
    it('unions and deduplicates dependencies_mentioned across runs', async () => {
      const file = makeCodeFile();
      const run1 = makeCodeReconstruction([file], { dependencies_mentioned: ['react', 'lodash'] });
      const run2 = makeCodeReconstruction([file], { dependencies_mentioned: ['react', 'axios'] });
      const run3 = makeCodeReconstruction([file], { dependencies_mentioned: ['lodash', 'axios'] });
      const runFn = makeRunFn([run1, run2, run3]);

      const result = await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [],
      });

      expect(result.mergedDependencies.sort()).toEqual(['axios', 'lodash', 'react']);
    });

    it('unions and deduplicates build_commands across runs', async () => {
      const file = makeCodeFile();
      const run1 = makeCodeReconstruction([file], { build_commands: ['npm install', 'npm run build'] });
      const run2 = makeCodeReconstruction([file], { build_commands: ['npm install', 'npm test'] });
      const run3 = makeCodeReconstruction([file], { build_commands: ['npm run build'] });
      const runFn = makeRunFn([run1, run2, run3]);

      const result = await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [],
      });

      expect(result.mergedBuildCommands.sort()).toEqual(['npm install', 'npm run build', 'npm test']);
    });
  });

  describe('empty run handling', () => {
    it('skips empty runs for file counting', async () => {
      const file = makeCodeFile({ filename: 'main.py' });
      const run1 = makeCodeReconstruction([file]);
      const run2 = makeCodeReconstruction([file]);
      const emptyRun = makeCodeReconstruction([]);

      const runFn = makeRunFn([run1, run2, emptyRun]);

      const result = await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [],
      });

      // main.py appears in 2 non-empty runs → confirmed (minAgreement=2)
      expect(result.confirmed.map(f => f.filename)).toContain('main.py');
    });
  });

  describe('single-run mode', () => {
    it('puts all files into confirmed when runs=1', async () => {
      const config: ConsensusConfig = { runs: 1, minAgreement: 1 };
      const files = [
        makeCodeFile({ filename: 'main.py' }),
        makeCodeFile({ filename: 'utils.py' }),
      ];
      const runFn = makeRunFn([makeCodeReconstruction(files)]);

      const result = await runCodeConsensus({
        config,
        runFn,
        pass2Results: [],
      });

      expect(result.confirmed).toHaveLength(2);
      expect(result.rejected).toHaveLength(0);
      expect(result.runsCompleted).toBe(1);
    });
  });

  describe('failure handling', () => {
    it('returns empty result when all 3 runs fail', async () => {
      const runFn = makeRunFn([
        new Error('Gemini API error'),
        new Error('Gemini API error'),
        new Error('Gemini API error'),
      ]);

      const result = await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [],
      });

      expect(result.confirmed).toHaveLength(0);
      expect(result.rejected).toHaveLength(0);
      expect(result.runsCompleted).toBe(0);
      expect(result.runsAttempted).toBe(3);
    });

    it('continues consensus when only 1 of 3 runs fails', async () => {
      const file = makeCodeFile({ filename: 'main.py' });
      const goodRun = makeCodeReconstruction([file]);

      const runFn = makeRunFn([
        goodRun,
        new Error('Gemini API error'),
        goodRun,
      ]);

      const result = await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [],
      });

      expect(result.runsCompleted).toBe(2);
      expect(result.runsAttempted).toBe(3);
      // Only 2 successful runs, but minAgreement=2, so main.py is confirmed
      expect(result.confirmed.map(f => f.filename)).toContain('main.py');
    });
  });

  describe('onProgress callback', () => {
    it('calls onProgress after each run with correct run number and total', async () => {
      const file = makeCodeFile();
      const runFn = makeRunFn([
        makeCodeReconstruction([file]),
        makeCodeReconstruction([file]),
        makeCodeReconstruction([file]),
      ]);

      const progressCalls: [number, number][] = [];
      const onProgress = vi.fn((run: number, total: number) => {
        progressCalls.push([run, total]);
      });

      await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [],
        onProgress,
      });

      expect(onProgress).toHaveBeenCalledTimes(3);
      expect(progressCalls).toEqual([
        [1, 3],
        [2, 3],
        [3, 3],
      ]);
    });

    it('calls onProgress even when a run fails', async () => {
      const runFn = makeRunFn([
        new Error('fail'),
        new Error('fail'),
        new Error('fail'),
      ]);

      const onProgress = vi.fn();

      await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [],
        onProgress,
      });

      expect(onProgress).toHaveBeenCalledTimes(3);
    });
  });

  describe('runsAttempted tracking', () => {
    it('tracks runsAttempted correctly', async () => {
      const file = makeCodeFile();
      const runFn = makeRunFn([
        makeCodeReconstruction([file]),
        makeCodeReconstruction([file]),
        makeCodeReconstruction([file]),
      ]);

      const result = await runCodeConsensus({
        config: DEFAULT_CONFIG,
        runFn,
        pass2Results: [],
      });

      expect(result.runsAttempted).toBe(3);
      expect(result.runsCompleted).toBe(3);
    });
  });
});

// ---------------------------------------------------------------------------
// runLinkConsensus
// ---------------------------------------------------------------------------

function makeLink(overrides: Partial<ExtractedLink> = {}): ExtractedLink {
  return {
    url: 'https://example.com',
    context: 'Some context',
    timestamp: '00:00:10',
    ...overrides,
  };
}

function makeChatExtraction(links: ExtractedLink[], messages: ChatExtraction['messages'] = []): ChatExtraction {
  return { messages, links };
}

function makeLinkRunFn(results: Array<ChatExtraction | Error>): () => Promise<ChatExtraction> {
  let callIndex = 0;
  return async () => {
    const result = results[callIndex % results.length];
    callIndex++;
    if (result instanceof Error) throw result;
    return result;
  };
}

const LINK_CONFIG: ConsensusConfig = { runs: 3, minAgreement: 2 };

describe('runLinkConsensus', () => {
  describe('all runs agree', () => {
    it('confirms links appearing in all 3 runs', async () => {
      const link = makeLink({ url: 'https://example.com/page' });
      const run = makeChatExtraction([link]);
      const runFn = makeLinkRunFn([run, run, run]);

      const result = await runLinkConsensus({ config: LINK_CONFIG, runFn });

      expect(result.merged).not.toBeNull();
      expect(result.merged!.links).toHaveLength(1);
      expect(result.merged!.links[0].url).toBe('https://example.com/page');
      expect(result.rejectedUrls).toHaveLength(0);
    });
  });

  describe('partial agreement', () => {
    it('confirms link appearing in 2/3 runs', async () => {
      const link = makeLink({ url: 'https://real-link.com' });
      const run1 = makeChatExtraction([link]);
      const run2 = makeChatExtraction([link]);
      const run3 = makeChatExtraction([]);
      const runFn = makeLinkRunFn([run1, run2, run3]);

      const result = await runLinkConsensus({ config: LINK_CONFIG, runFn });

      expect(result.merged!.links).toHaveLength(1);
      expect(result.rejectedUrls).toHaveLength(0);
    });

    it('rejects link appearing in only 1/3 runs (hallucination)', async () => {
      const realLink = makeLink({ url: 'https://real.com' });
      const fakeLink = makeLink({ url: 'https://hallucinated-8a1b2b1b.com' });
      const run1 = makeChatExtraction([realLink, fakeLink]);
      const run2 = makeChatExtraction([realLink]);
      const run3 = makeChatExtraction([realLink]);
      const runFn = makeLinkRunFn([run1, run2, run3]);

      const result = await runLinkConsensus({ config: LINK_CONFIG, runFn });

      expect(result.merged!.links).toHaveLength(1);
      expect(result.merged!.links[0].url).toBe('https://real.com');
      expect(result.rejectedUrls).toContain('https://hallucinated-8a1b2b1b.com');
    });
  });

  describe('URL normalization', () => {
    it('treats http and https as the same URL', async () => {
      const link1 = makeLink({ url: 'http://example.com/page' });
      const link2 = makeLink({ url: 'https://example.com/page' });
      const link3 = makeLink({ url: 'https://example.com/page' });
      const runFn = makeLinkRunFn([
        makeChatExtraction([link1]),
        makeChatExtraction([link2]),
        makeChatExtraction([link3]),
      ]);

      const result = await runLinkConsensus({ config: LINK_CONFIG, runFn });

      expect(result.merged!.links).toHaveLength(1);
    });

    it('treats www and non-www as the same URL', async () => {
      const link1 = makeLink({ url: 'https://www.example.com' });
      const link2 = makeLink({ url: 'https://example.com' });
      const link3 = makeLink({ url: 'http://www.example.com/' });
      const runFn = makeLinkRunFn([
        makeChatExtraction([link1]),
        makeChatExtraction([link2]),
        makeChatExtraction([link3]),
      ]);

      const result = await runLinkConsensus({ config: LINK_CONFIG, runFn });

      expect(result.merged!.links).toHaveLength(1);
    });

    it('strips trailing slash for matching', async () => {
      const link1 = makeLink({ url: 'https://example.com/path/' });
      const link2 = makeLink({ url: 'https://example.com/path' });
      const link3 = makeLink({ url: 'https://example.com/path/' });
      const runFn = makeLinkRunFn([
        makeChatExtraction([link1]),
        makeChatExtraction([link2]),
        makeChatExtraction([link3]),
      ]);

      const result = await runLinkConsensus({ config: LINK_CONFIG, runFn });

      expect(result.merged!.links).toHaveLength(1);
    });
  });

  describe('best context selection', () => {
    it('selects the link version with the longest context', async () => {
      const short = makeLink({ url: 'https://example.com', context: 'A link' });
      const long = makeLink({ url: 'https://example.com', context: 'Daniel Glazer sharing a detailed FAQ about US expansion for UK founders' });
      const medium = makeLink({ url: 'https://example.com', context: 'FAQ about US expansion' });
      const runFn = makeLinkRunFn([
        makeChatExtraction([short]),
        makeChatExtraction([long]),
        makeChatExtraction([medium]),
      ]);

      const result = await runLinkConsensus({ config: LINK_CONFIG, runFn });

      expect(result.merged!.links[0].context).toBe(long.context);
    });
  });

  describe('messages handling', () => {
    it('uses messages from the run with the most messages', async () => {
      const link = makeLink();
      const msg1 = { sender: 'Alice', text: 'Hello', timestamp: '00:00:01' };
      const msg2 = { sender: 'Bob', text: 'Hi', timestamp: '00:00:02' };
      const msg3 = { sender: 'Carol', text: 'Hey', timestamp: '00:00:03' };
      const runFn = makeLinkRunFn([
        makeChatExtraction([link], [msg1]),
        makeChatExtraction([link], [msg1, msg2, msg3]),
        makeChatExtraction([link], [msg1, msg2]),
      ]);

      const result = await runLinkConsensus({ config: LINK_CONFIG, runFn });

      expect(result.merged!.messages).toHaveLength(3);
    });
  });

  describe('failure handling', () => {
    it('returns null merged when all runs fail', async () => {
      const runFn = makeLinkRunFn([
        new Error('API error'),
        new Error('API error'),
        new Error('API error'),
      ]);

      const result = await runLinkConsensus({ config: LINK_CONFIG, runFn });

      expect(result.merged).toBeNull();
      expect(result.runsCompleted).toBe(0);
      expect(result.runsAttempted).toBe(3);
    });

    it('continues when 1 of 3 runs fails', async () => {
      const link = makeLink({ url: 'https://real.com' });
      const run = makeChatExtraction([link]);
      const runFn = makeLinkRunFn([run, new Error('fail'), run]);

      const result = await runLinkConsensus({ config: LINK_CONFIG, runFn });

      expect(result.runsCompleted).toBe(2);
      expect(result.merged!.links).toHaveLength(1);
    });
  });

  describe('single-run mode', () => {
    it('returns all links when runs=1', async () => {
      const config: ConsensusConfig = { runs: 1, minAgreement: 1 };
      const links = [makeLink({ url: 'https://a.com' }), makeLink({ url: 'https://b.com' })];
      const runFn = makeLinkRunFn([makeChatExtraction(links)]);

      const result = await runLinkConsensus({ config, runFn });

      expect(result.merged!.links).toHaveLength(2);
      expect(result.rejectedUrls).toHaveLength(0);
    });
  });

  describe('onProgress callback', () => {
    it('calls onProgress after each run', async () => {
      const link = makeLink();
      const runFn = makeLinkRunFn([
        makeChatExtraction([link]),
        makeChatExtraction([link]),
        makeChatExtraction([link]),
      ]);

      const progressCalls: [number, number][] = [];
      const onProgress = vi.fn((run: number, total: number) => {
        progressCalls.push([run, total]);
      });

      await runLinkConsensus({ config: LINK_CONFIG, runFn, onProgress });

      expect(onProgress).toHaveBeenCalledTimes(3);
      expect(progressCalls).toEqual([[1, 3], [2, 3], [3, 3]]);
    });
  });
});
