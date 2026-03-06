import { spinner, progress, log, isTTY, isCI } from '@clack/prompts';
import type { ProgressStatus, PipelineResult } from '../types/index.js';

export const PHASE_LABELS: Record<string, string> = {
  pass0: 'Understanding your video...',
  pass1: 'Extracting transcript...',
  pass1a: 'Transcribing...',
  pass1b: 'Identifying speakers...',
  pass2: 'Analyzing visuals...',
  pass3a: 'Reconstructing code...',
  pass3b: 'Identifying participants...',
  pass3c: 'Reading chat messages...',
  pass3d: 'Detecting insights...',
  synthesis: 'Synthesizing notes...',
  output: 'Writing output files...',
};

export interface ProgressDisplay {
  update(status: ProgressStatus): void;
  onWait(delayMs: number): void;
  complete(result: PipelineResult, elapsedMs: number): void;
}

export function createProgressDisplay(): ProgressDisplay {
  const interactive = isTTY(process.stdout) && !isCI();

  if (!interactive) {
    let lastMessage: string | null = null;

    function emit(message: string) {
      if (message === lastMessage) return;
      lastMessage = message;
      log.info(message);
    }

    function labelFor(status: ProgressStatus): string {
      const label = PHASE_LABELS[status.phase] ?? status.phase;
      if (status.currentStep != null && status.totalSteps != null) {
        return `${label} (${status.currentStep}/${status.totalSteps})`;
      }
      return label;
    }

    return {
      update(status: ProgressStatus) {
        if (status.status !== 'done') return;
        emit(labelFor(status));
      },
      onWait(_delayMs: number) {
        // No-op — rate limit pauses are invisible to the user
      },
      complete(_result: PipelineResult, _elapsedMs: number) {
        // No-op for non-interactive output
      },
    };
  }

  const s = spinner();
  s.start(PHASE_LABELS.pass0);

  let progressBar: ReturnType<typeof progress> | null = null;
  let seenTotalSteps = false;

  function update(status: ProgressStatus): void {
    const label = PHASE_LABELS[status.phase] ?? status.phase;

    // During pass0: use spinner with pass0 label
    if (status.phase === 'pass0') {
      s.message(label);
      return;
    }

    // First time we see totalSteps: switch from spinner to progress bar
    if (!seenTotalSteps && status.totalSteps != null) {
      seenTotalSteps = true;
      s.stop('');
      progressBar = progress({ max: status.totalSteps });
      progressBar.start(label);
    }

    if (progressBar != null) {
      // Only 'done' events advance the bar (retries stay 'running' and do NOT advance)
      if (status.status === 'done' && status.currentStep != null) {
        progressBar.advance(1, label);
      }
      // 'running' events: bar stays put (no message update needed)
    } else {
      // Fallback: no progress bar yet, use spinner
      if (status.status === 'done' && status.currentStep != null && status.totalSteps != null) {
        s.message(`${label} (${status.currentStep}/${status.totalSteps})`);
      } else {
        s.message(label);
      }
    }
  }

  function onWait(_delayMs: number): void {
    // No-op — rate limit pauses are invisible to the user
  }

  function complete(_result: PipelineResult, _elapsedMs: number): void {
    if (progressBar != null) {
      progressBar.stop('');
    } else {
      s.stop('');
    }
  }

  return { update, onWait, complete };
}
