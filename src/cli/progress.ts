import { spinner, progress } from '@clack/prompts';
import type { ProgressStatus, PipelineResult } from '../types/index.js';

export const PHASE_LABELS: Record<string, string> = {
  pass0: 'Understanding your video...',
  pass1: 'Extracting transcript...',
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

  function complete(result: PipelineResult, _elapsedMs: number): void {
    if (progressBar != null) {
      if (result.errors.length > 0) {
        progressBar.stop('');
      } else {
        progressBar.stop('');
      }
    } else {
      s.stop('');
    }
  }

  return { update, onWait, complete };
}
