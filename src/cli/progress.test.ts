import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSpinner = {
  start: vi.fn(),
  stop: vi.fn(),
  error: vi.fn(),
  message: vi.fn(),
};

const mockProgressBar = {
  advance: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  message: vi.fn(),
};

vi.mock('@clack/prompts', () => ({
  spinner: vi.fn(() => mockSpinner),
  progress: vi.fn(() => mockProgressBar),
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

import { progress, log } from '@clack/prompts';
import { createProgressDisplay, PHASE_LABELS } from './progress.js';

describe('PHASE_LABELS', () => {
  it('has correct label for pass0', () => {
    expect(PHASE_LABELS.pass0).toBe('Understanding your video...');
  });

  it('has correct label for pass1', () => {
    expect(PHASE_LABELS.pass1).toBe('Extracting transcript...');
  });

  it('has correct label for pass1a', () => {
    expect(PHASE_LABELS.pass1a).toBe('Transcribing...');
  });

  it('has correct label for pass1b', () => {
    expect(PHASE_LABELS.pass1b).toBe('Identifying speakers...');
  });

  it('has correct label for pass2', () => {
    expect(PHASE_LABELS.pass2).toBe('Analyzing visuals...');
  });

  it('has correct label for pass3a', () => {
    expect(PHASE_LABELS.pass3a).toBe('Reconstructing code...');
  });

  it('has correct label for pass3b', () => {
    expect(PHASE_LABELS.pass3b).toBe('Identifying participants...');
  });

  it('has correct label for pass3c', () => {
    expect(PHASE_LABELS.pass3c).toBe('Reading chat messages...');
  });

  it('has correct label for pass3d', () => {
    expect(PHASE_LABELS.pass3d).toBe('Detecting insights...');
  });

  it('has correct label for synthesis', () => {
    expect(PHASE_LABELS.synthesis).toBe('Synthesizing notes...');
  });

  it('has correct label for output', () => {
    expect(PHASE_LABELS.output).toBe('Writing output files...');
  });
});

describe('createProgressDisplay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts spinner with pass0 label on creation', () => {
    createProgressDisplay();
    expect(mockSpinner.start).toHaveBeenCalledWith('Understanding your video...');
  });

  it('update() with pass0 phase shows spinner message', () => {
    const display = createProgressDisplay();
    display.update({ phase: 'pass0', segment: 0, totalSegments: 1, status: 'running' });
    expect(mockSpinner.message).toHaveBeenCalledWith('Understanding your video...');
  });

  it('update() with pass0 done does not switch to progress bar', () => {
    const display = createProgressDisplay();
    display.update({ phase: 'pass0', segment: 0, totalSegments: 1, status: 'done', currentStep: 0, totalSteps: 10 });
    expect(progress).not.toHaveBeenCalled();
    expect(mockSpinner.message).toHaveBeenCalledWith('Understanding your video...');
  });

  it('switches from spinner to progress bar when totalSteps first appears (non-pass0)', () => {
    const display = createProgressDisplay();
    display.update({ phase: 'pass1', segment: 0, totalSegments: 3, status: 'running', totalSteps: 10 });
    expect(mockSpinner.stop).toHaveBeenCalledWith('');
    expect(progress).toHaveBeenCalledWith({ max: 10 });
    expect(mockProgressBar.start).toHaveBeenCalledWith('Extracting transcript...');
  });

  it('does not create progress bar twice', () => {
    const display = createProgressDisplay();
    display.update({ phase: 'pass1', segment: 0, totalSegments: 3, status: 'running', totalSteps: 10 });
    display.update({ phase: 'pass1', segment: 0, totalSegments: 3, status: 'done', currentStep: 1, totalSteps: 10 });
    expect(progress).toHaveBeenCalledTimes(1);
  });

  it('advance() is called on progress bar when status is done', () => {
    const display = createProgressDisplay();
    // First update triggers bar creation
    display.update({ phase: 'pass1', segment: 0, totalSegments: 3, status: 'running', totalSteps: 10 });
    // Done event advances bar
    display.update({ phase: 'pass1', segment: 0, totalSegments: 3, status: 'done', currentStep: 1, totalSteps: 10 });
    expect(mockProgressBar.advance).toHaveBeenCalledWith(1, 'Extracting transcript...');
  });

  it('advance() is NOT called when status is running (retry protection)', () => {
    const display = createProgressDisplay();
    display.update({ phase: 'pass1', segment: 0, totalSegments: 3, status: 'running', totalSteps: 10 });
    display.update({ phase: 'pass1', segment: 0, totalSegments: 3, status: 'running', totalSteps: 10 });
    expect(mockProgressBar.advance).not.toHaveBeenCalled();
  });

  it('advance() uses correct phase label for pass3b', () => {
    const display = createProgressDisplay();
    display.update({ phase: 'pass3b', segment: 0, totalSegments: 1, status: 'running', totalSteps: 5 });
    display.update({ phase: 'pass3b', segment: 0, totalSegments: 1, status: 'done', currentStep: 1, totalSteps: 5 });
    expect(mockProgressBar.advance).toHaveBeenCalledWith(1, 'Identifying participants...');
  });

  it('advance() uses fallback label for unknown phase', () => {
    const display = createProgressDisplay();
    display.update({ phase: 'unknown', segment: 0, totalSegments: 1, status: 'running', totalSteps: 5 });
    display.update({ phase: 'unknown', segment: 0, totalSegments: 1, status: 'done', currentStep: 1, totalSteps: 5 });
    expect(mockProgressBar.advance).toHaveBeenCalledWith(1, 'unknown');
  });

  it('onWait() is a no-op — does not call spinner message', () => {
    const display = createProgressDisplay();
    display.onWait(3000);
    expect(mockSpinner.message).not.toHaveBeenCalled();
  });

  it('complete() stops spinner when no progress bar was created', () => {
    const display = createProgressDisplay();
    display.complete({ segments: [{ index: 0, pass1: null, pass2: null }], passesRun: ['pass1', 'pass2'], errors: [] }, 5000);
    expect(mockSpinner.stop).toHaveBeenCalledWith('');
  });

  it('complete() stops progress bar when it was created', () => {
    const display = createProgressDisplay();
    // Trigger progress bar creation
    display.update({ phase: 'pass1', segment: 0, totalSegments: 3, status: 'running', totalSteps: 10 });
    vi.clearAllMocks();
    display.complete({ segments: [], passesRun: ['pass1', 'pass2'], errors: [] }, 5000);
    expect(mockProgressBar.stop).toHaveBeenCalledWith('');
    expect(mockSpinner.stop).not.toHaveBeenCalled();
  });
});
