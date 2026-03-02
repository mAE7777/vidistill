import { describe, it, expect } from 'vitest';
import { formatTime, applySpeakerMapping } from './utils.js';

describe('formatTime', () => {
  it('formats zero as 00:00:00', () => {
    expect(formatTime(0)).toBe('00:00:00');
  });

  it('formats 3661 as 01:01:01', () => {
    expect(formatTime(3661)).toBe('01:01:01');
  });

  it('formats 59.9 as 00:00:59', () => {
    expect(formatTime(59.9)).toBe('00:00:59');
  });

  it('formats 3600 as 01:00:00', () => {
    expect(formatTime(3600)).toBe('01:00:00');
  });

  it('clamps NaN to 00:00:00', () => {
    expect(formatTime(NaN)).toBe('00:00:00');
  });

  it('clamps negative values to 00:00:00', () => {
    expect(formatTime(-1)).toBe('00:00:00');
    expect(formatTime(-100)).toBe('00:00:00');
  });

  it('clamps Infinity to 00:00:00', () => {
    expect(formatTime(Infinity)).toBe('00:00:00');
    expect(formatTime(-Infinity)).toBe('00:00:00');
  });

  it('formats large values correctly', () => {
    expect(formatTime(86400)).toBe('24:00:00');
  });
});

describe('applySpeakerMapping', () => {
  it('returns mapped name when label exists in mapping', () => {
    expect(applySpeakerMapping('SPEAKER_00', { SPEAKER_00: 'Alice' })).toBe('Alice');
  });

  it('returns original label when not in mapping', () => {
    expect(applySpeakerMapping('SPEAKER_01', { SPEAKER_00: 'Alice' })).toBe('SPEAKER_01');
  });

  it('returns original label when mapping is undefined', () => {
    expect(applySpeakerMapping('SPEAKER_00', undefined)).toBe('SPEAKER_00');
  });

  it('returns original label when mapping is empty', () => {
    expect(applySpeakerMapping('SPEAKER_00', {})).toBe('SPEAKER_00');
  });

  it('handles multiple entries in mapping', () => {
    const mapping = { SPEAKER_00: 'Alice', SPEAKER_01: 'Bob' };
    expect(applySpeakerMapping('SPEAKER_00', mapping)).toBe('Alice');
    expect(applySpeakerMapping('SPEAKER_01', mapping)).toBe('Bob');
  });
});
