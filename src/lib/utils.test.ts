import { describe, it, expect } from 'vitest';
import { formatTime, applySpeakerMapping, buildExpandedMapping } from './utils.js';
import type { SegmentResult, Pass1Result } from '../types/index.js';

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

  it('extracts SPEAKER_XX from "SPEAKER_XX (description)" format', () => {
    const mapping = { SPEAKER_00: 'Alice' };
    expect(applySpeakerMapping('SPEAKER_00 (some person)', mapping)).toBe('Alice');
  });

  it('strips parenthetical suffix for name lookup', () => {
    const mapping = { 'K Iphone': 'Kristian' };
    expect(applySpeakerMapping('K Iphone (Chris)', mapping)).toBe('Kristian');
  });

  it('falls back to case-insensitive match', () => {
    const mapping = { 'Chenhao Kang': 'Steven Kang' };
    expect(applySpeakerMapping('chenhao Kang', mapping)).toBe('Steven Kang');
  });

  it('prefers direct match over fallbacks', () => {
    const mapping = { 'SPEAKER_00 (Alice)': 'Exact', SPEAKER_00: 'Prefix' };
    expect(applySpeakerMapping('SPEAKER_00 (Alice)', mapping)).toBe('Exact');
  });
});

describe('buildExpandedMapping', () => {
  function makePass1(speakers: { id: string; desc: string }[], entries: { speaker: string }[]): Pass1Result {
    return {
      segment_index: 0,
      time_range: '00:00:00 - 00:10:00',
      speaker_summary: speakers.map((s) => ({ speaker_id: s.id, description: s.desc })),
      transcript_entries: entries.map((e) => ({
        timestamp: '00:00:00',
        speaker: e.speaker,
        text: 'hello',
        tone: 'neutral',
      })),
    };
  }

  function makeSeg(pass1: Pass1Result): SegmentResult {
    return { index: 0, pass1, pass2: null };
  }

  it('maps detected name from description to user-assigned name', () => {
    const pass1 = makePass1(
      [{ id: 'SPEAKER_00', desc: 'Haoxuan Wang, a student' }],
      [{ speaker: 'SPEAKER_00' }],
    );
    const result = buildExpandedMapping([makeSeg(pass1)], { SPEAKER_00: 'Mike Wang' });
    expect(result['Haoxuan Wang']).toBe('Mike Wang');
    expect(result['SPEAKER_00']).toBe('Mike Wang');
  });

  it('maps alt name from parens in description', () => {
    const pass1 = makePass1(
      [{ id: 'SPEAKER_05', desc: 'Chris (K Iphone), a student' }],
      [{ speaker: 'SPEAKER_05' }],
    );
    const result = buildExpandedMapping([makeSeg(pass1)], { SPEAKER_05: 'Kristian' });
    expect(result['Chris']).toBe('Kristian');
    expect(result['K Iphone']).toBe('Kristian');
  });

  it('maps name from transcript entry speaker field', () => {
    const pass1 = makePass1(
      [{ id: 'SPEAKER_02', desc: 'Chenhao Kang, a student' }],
      [{ speaker: 'SPEAKER_02 (chenhao Kang)' }],
    );
    const result = buildExpandedMapping([makeSeg(pass1)], { SPEAKER_02: 'Steven Kang' });
    expect(result['chenhao Kang']).toBe('Steven Kang');
    expect(result['Chenhao Kang']).toBe('Steven Kang');
  });

  it('preserves original SPEAKER_XX keys', () => {
    const pass1 = makePass1(
      [{ id: 'SPEAKER_00', desc: 'Alice, presenter' }],
      [{ speaker: 'SPEAKER_00' }],
    );
    const mapping = { SPEAKER_00: 'Alice B' };
    const result = buildExpandedMapping([makeSeg(pass1)], mapping);
    expect(result['SPEAKER_00']).toBe('Alice B');
  });

  it('skips speakers not in user mapping', () => {
    const pass1 = makePass1(
      [{ id: 'SPEAKER_01', desc: 'Bob, viewer' }],
      [{ speaker: 'SPEAKER_01' }],
    );
    const result = buildExpandedMapping([makeSeg(pass1)], { SPEAKER_00: 'Alice' });
    expect(result['Bob']).toBeUndefined();
  });

  it('does not add identity mappings', () => {
    const pass1 = makePass1(
      [{ id: 'SPEAKER_00', desc: 'Alice, presenter' }],
      [{ speaker: 'SPEAKER_00 (Alice)' }],
    );
    const result = buildExpandedMapping([makeSeg(pass1)], { SPEAKER_00: 'Alice' });
    // 'Alice' → 'Alice' should not be added
    expect(Object.keys(result)).not.toContain('Alice');
  });
});
