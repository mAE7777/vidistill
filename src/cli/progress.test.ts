import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSpinner = {
  start: vi.fn(),
  stop: vi.fn(),
  message: vi.fn(),
};

vi.mock('@clack/prompts', () => ({
  spinner: vi.fn(() => mockSpinner),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('picocolors', () => ({
  default: {
    green: (s: string) => s,
    yellow: (s: string) => s,
    cyan: (s: string) => s,
  },
}));

import { log } from '@clack/prompts';
import { createProgressDisplay } from './progress.js';

describe('createProgressDisplay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts spinner immediately on creation', () => {
    createProgressDisplay();
    expect(mockSpinner.start).toHaveBeenCalledWith('Starting pipeline...');
  });

  it('update() shows pass1 message', () => {
    const display = createProgressDisplay();
    display.update({ phase: 'pass1', segment: 0, totalSegments: 3, status: 'running' });
    expect(mockSpinner.message).toHaveBeenCalledWith('Pass 1: Transcript (1/3 segments)');
  });

  it('update() shows pass2 message', () => {
    const display = createProgressDisplay();
    display.update({ phase: 'pass2', segment: 2, totalSegments: 5, status: 'running' });
    expect(mockSpinner.message).toHaveBeenCalledWith('Pass 2: Visual extraction (3/5 segments)');
  });

  it('update() shows "Analyzing video..." for pass0 phase', () => {
    const display = createProgressDisplay();
    display.update({ phase: 'pass0', segment: 0, totalSegments: 1, status: 'running' });
    expect(mockSpinner.message).toHaveBeenCalledWith('Analyzing video...');
  });

  it('update() shows pass3a message with segment count', () => {
    const display = createProgressDisplay();
    display.update({ phase: 'pass3a', segment: 2, totalSegments: 5, status: 'running' });
    expect(mockSpinner.message).toHaveBeenCalledWith('Code reconstruction (3/5 segments)');
  });

  it('update() shows pass3b message without segment count', () => {
    const display = createProgressDisplay();
    display.update({ phase: 'pass3b', segment: 0, totalSegments: 1, status: 'running' });
    expect(mockSpinner.message).toHaveBeenCalledWith('People extraction...');
  });

  it('update() shows pass3c message with segment count', () => {
    const display = createProgressDisplay();
    display.update({ phase: 'pass3c', segment: 1, totalSegments: 4, status: 'running' });
    expect(mockSpinner.message).toHaveBeenCalledWith('Chat extraction (2/4 segments)');
  });

  it('update() shows pass3d message with segment count', () => {
    const display = createProgressDisplay();
    display.update({ phase: 'pass3d', segment: 0, totalSegments: 2, status: 'running' });
    expect(mockSpinner.message).toHaveBeenCalledWith('Implicit signals (1/2 segments)');
  });

  it('update() shows synthesis message without segment count', () => {
    const display = createProgressDisplay();
    display.update({ phase: 'synthesis', segment: 0, totalSegments: 1, status: 'running' });
    expect(mockSpinner.message).toHaveBeenCalledWith('Synthesizing results...');
  });

  it('update() shows generic message for unknown phase', () => {
    const display = createProgressDisplay();
    display.update({ phase: 'unknown', segment: 0, totalSegments: 1, status: 'running' });
    expect(mockSpinner.message).toHaveBeenCalledWith('unknown (1/1 segments)');
  });

  it('onWait() shows rate limit message with ceiling seconds', () => {
    const display = createProgressDisplay();
    display.onWait(1500);
    expect(mockSpinner.message).toHaveBeenCalledWith('Waiting for rate limit... (2s)');
  });

  it('complete() stops spinner with success when no errors', () => {
    const display = createProgressDisplay();
    display.complete({ segments: [{ index: 0, pass1: null, pass2: null }], passesRun: ['pass1', 'pass2'], errors: [] }, 5000);
    expect(log.success as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('All segments completed successfully');
  });

  it('complete() stops spinner with warning when errors exist', () => {
    const display = createProgressDisplay();
    display.complete({ segments: [], passesRun: ['pass1', 'pass2'], errors: ['some error'] }, 5000);
    expect(log.warn as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('Errors: 1');
  });

  it('complete() shows elapsed time in minutes when > 60s', () => {
    const display = createProgressDisplay();
    display.complete({ segments: [], passesRun: ['pass1'], errors: [] }, 125000);
    const infoCalls = (log.info as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]) as string[];
    const timeCall = infoCalls.find((c) => c.includes('Time elapsed'));
    expect(timeCall).toContain('2m 5s');
  });
});
