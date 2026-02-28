import { spinner, log } from '@clack/prompts';
import pc from 'picocolors';
import type { ProgressStatus, PipelineResult } from '../types/index.js';

export interface ProgressDisplay {
  update(status: ProgressStatus): void;
  onWait(delayMs: number): void;
  complete(result: PipelineResult, elapsedMs: number): void;
}

export function createProgressDisplay(): ProgressDisplay {
  const s = spinner();
  s.start('Starting pipeline...');

  function update(status: ProgressStatus): void {
    const segNum = status.segment + 1;
    const total = status.totalSegments;

    if (status.phase === 'pass0') {
      s.message('Analyzing video...');
    } else if (status.phase === 'pass1') {
      s.message(`Pass 1: Transcript (${segNum}/${total} segments)`);
    } else if (status.phase === 'pass2') {
      s.message(`Pass 2: Visual extraction (${segNum}/${total} segments)`);
    } else if (status.phase === 'pass3a') {
      s.message(`Code reconstruction (${segNum}/${total} segments)`);
    } else if (status.phase === 'pass3b') {
      s.message('People extraction...');
    } else if (status.phase === 'pass3c') {
      s.message(`Chat extraction (${segNum}/${total} segments)`);
    } else if (status.phase === 'pass3d') {
      s.message(`Implicit signals (${segNum}/${total} segments)`);
    } else if (status.phase === 'synthesis') {
      s.message('Synthesizing results...');
    } else if (status.phase === 'output') {
      s.message('Generating output files...');
    } else {
      s.message(`${status.phase} (${segNum}/${total} segments)`);
    }
  }

  function onWait(delayMs: number): void {
    const secs = Math.ceil(delayMs / 1000);
    s.message(`Waiting for rate limit... (${secs}s)`);
  }

  function complete(result: PipelineResult, elapsedMs: number): void {
    const elapsedSecs = Math.round(elapsedMs / 1000);
    const mins = Math.floor(elapsedSecs / 60);
    const secs = elapsedSecs % 60;
    const elapsed = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    const errorCount = result.errors.length;
    if (errorCount > 0) {
      s.stop(pc.yellow('Pipeline complete (with errors)'));
    } else {
      s.stop(pc.green('Pipeline complete'));
    }

    log.info(`Segments processed: ${pc.cyan(String(result.segments.length))}`);
    log.info(`Passes run: ${pc.cyan(result.passesRun.join(', '))}`);
    log.info(`Time elapsed: ${pc.cyan(elapsed)}`);

    if (errorCount > 0) {
      log.warn(`Errors: ${pc.yellow(String(errorCount))}`);
    } else {
      log.success('All segments completed successfully');
    }
  }

  return { update, onWait, complete };
}
