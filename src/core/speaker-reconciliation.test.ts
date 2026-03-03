import { describe, it, expect } from 'vitest';
import { reconcileSpeakers } from './speaker-reconciliation.js';
import type { Pass1Result, TranscriptEntry, SpeakerInfo } from '../types/index.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEntry(speaker: string, text = 'hello'): TranscriptEntry {
  return { timestamp: '00:00:01', speaker, text, tone: 'neutral' };
}

function makeSpeakerInfo(speaker_id: string, description = ''): SpeakerInfo {
  return { speaker_id, description };
}

function makePass1(
  segmentIndex: number,
  speakerSummary: SpeakerInfo[],
  transcriptEntries: TranscriptEntry[],
): Pass1Result {
  return {
    segment_index: segmentIndex,
    time_range: `00:0${segmentIndex}:00 - 00:0${segmentIndex + 1}:00`,
    speaker_summary: speakerSummary,
    transcript_entries: transcriptEntries,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('reconcileSpeakers', () => {
  // AC: no Pass1Results → empty result
  describe('all null pass1Results', () => {
    it('returns empty mapping and empty canonical speaker list', () => {
      const result = reconcileSpeakers({ pass1Results: [null, null, null] });
      expect(result.mapping).toEqual({});
      expect(result.canonicalSpeakers).toEqual([]);
    });

    it('returns empty result for an empty array', () => {
      const result = reconcileSpeakers({ pass1Results: [] });
      expect(result.mapping).toEqual({});
      expect(result.canonicalSpeakers).toEqual([]);
    });
  });

  // AC: single segment → identity mapping
  describe('single segment', () => {
    it('maps speakers to themselves (identity) for a named speaker', () => {
      const p1 = makePass1(
        0,
        [makeSpeakerInfo('SPEAKER_00 (Alice)', 'host')],
        [makeEntry('SPEAKER_00 (Alice)')],
      );
      const result = reconcileSpeakers({ pass1Results: [p1] });

      expect(result.mapping['0:SPEAKER_00 (Alice)']).toBe('SPEAKER_00 (Alice)');
      expect(result.canonicalSpeakers).toHaveLength(1);
      expect(result.canonicalSpeakers[0].label).toBe('SPEAKER_00 (Alice)');
    });

    it('maps an unnamed speaker to a canonical label', () => {
      const p1 = makePass1(
        0,
        [makeSpeakerInfo('SPEAKER_00', 'unknown')],
        [makeEntry('SPEAKER_00')],
      );
      const result = reconcileSpeakers({ pass1Results: [p1] });

      expect(result.mapping['0:SPEAKER_00']).toBe('SPEAKER_00');
      expect(result.canonicalSpeakers).toHaveLength(1);
      expect(result.canonicalSpeakers[0].label).toBe('SPEAKER_00');
    });

    it('handles multiple speakers in a single segment', () => {
      const p1 = makePass1(
        0,
        [
          makeSpeakerInfo('SPEAKER_00 (Alice)', 'host'),
          makeSpeakerInfo('SPEAKER_01 (Bob)', 'guest'),
        ],
        [makeEntry('SPEAKER_00 (Alice)'), makeEntry('SPEAKER_01 (Bob)')],
      );
      const result = reconcileSpeakers({ pass1Results: [p1] });

      expect(result.mapping['0:SPEAKER_00 (Alice)']).toBe('SPEAKER_00 (Alice)');
      expect(result.mapping['0:SPEAKER_01 (Bob)']).toBe('SPEAKER_01 (Bob)');
      expect(result.canonicalSpeakers).toHaveLength(2);
    });
  });

  // AC: same name across segments → same canonical label
  describe('named speaker appears in multiple segments with different SPEAKER_XX numbers', () => {
    it('merges SPEAKER_00 (Eugene) and SPEAKER_01 (Eugene) into one canonical label', () => {
      const seg0 = makePass1(
        0,
        [makeSpeakerInfo('SPEAKER_00 (Eugene)', 'lead dev')],
        [makeEntry('SPEAKER_00 (Eugene)')],
      );
      const seg1 = makePass1(
        1,
        [makeSpeakerInfo('SPEAKER_01 (Eugene)', 'same person')],
        [makeEntry('SPEAKER_01 (Eugene)')],
      );

      const result = reconcileSpeakers({ pass1Results: [seg0, seg1] });

      const canon0 = result.mapping['0:SPEAKER_00 (Eugene)'];
      const canon1 = result.mapping['1:SPEAKER_01 (Eugene)'];

      expect(canon0).toBe(canon1);
      // Canonical label should carry the name
      expect(canon0).toMatch(/Eugene/);
      // Only one canonical speaker for Eugene
      expect(result.canonicalSpeakers.filter(s => /Eugene/i.test(s.label))).toHaveLength(1);
    });

    it('is case-insensitive when grouping by name', () => {
      const seg0 = makePass1(
        0,
        [makeSpeakerInfo('SPEAKER_00 (Alice)', '')],
        [makeEntry('SPEAKER_00 (Alice)')],
      );
      const seg1 = makePass1(
        1,
        [makeSpeakerInfo('SPEAKER_00 (alice)', '')],
        [makeEntry('SPEAKER_00 (alice)')],
      );

      const result = reconcileSpeakers({ pass1Results: [seg0, seg1] });

      const canon0 = result.mapping['0:SPEAKER_00 (Alice)'];
      const canon1 = result.mapping['1:SPEAKER_00 (alice)'];

      expect(canon0).toBe(canon1);
      expect(result.canonicalSpeakers).toHaveLength(1);
    });
  });

  // AC: same SPEAKER_XX number but different names → different canonical labels
  describe('same SPEAKER_XX number but different names across segments', () => {
    it('assigns different canonical labels to SPEAKER_00 (Alice) and SPEAKER_00 (Bob)', () => {
      const seg0 = makePass1(
        0,
        [makeSpeakerInfo('SPEAKER_00 (Alice)', 'first speaker')],
        [makeEntry('SPEAKER_00 (Alice)')],
      );
      const seg1 = makePass1(
        1,
        [makeSpeakerInfo('SPEAKER_00 (Bob)', 'second speaker')],
        [makeEntry('SPEAKER_00 (Bob)')],
      );

      const result = reconcileSpeakers({ pass1Results: [seg0, seg1] });

      const canonAlice = result.mapping['0:SPEAKER_00 (Alice)'];
      const canonBob = result.mapping['1:SPEAKER_00 (Bob)'];

      expect(canonAlice).not.toBe(canonBob);
      expect(canonAlice).toMatch(/Alice/);
      expect(canonBob).toMatch(/Bob/);
      expect(result.canonicalSpeakers).toHaveLength(2);
    });
  });

  // AC: unnamed speaker in only one segment → unique canonical label
  describe('unnamed speaker appears in only one segment', () => {
    it('gives an unnamed speaker a unique canonical label', () => {
      const seg0 = makePass1(
        0,
        [makeSpeakerInfo('SPEAKER_00', 'unknown person')],
        [makeEntry('SPEAKER_00')],
      );
      const seg1 = makePass1(
        1,
        [makeSpeakerInfo('SPEAKER_00', 'different unknown')],
        [makeEntry('SPEAKER_00')],
      );

      const result = reconcileSpeakers({ pass1Results: [seg0, seg1] });

      const canon0 = result.mapping['0:SPEAKER_00'];
      const canon1 = result.mapping['1:SPEAKER_00'];

      // Unnamed speakers are NOT merged across segments
      expect(canon0).not.toBe(canon1);
      expect(result.canonicalSpeakers).toHaveLength(2);
    });
  });

  // Sequential canonical ID assignment
  describe('canonical ID assignment order', () => {
    it('assigns canonical IDs in order of first appearance', () => {
      const seg0 = makePass1(
        0,
        [
          makeSpeakerInfo('SPEAKER_00 (Alice)', ''),
          makeSpeakerInfo('SPEAKER_01 (Bob)', ''),
        ],
        [makeEntry('SPEAKER_00 (Alice)'), makeEntry('SPEAKER_01 (Bob)')],
      );

      const result = reconcileSpeakers({ pass1Results: [seg0] });

      // Alice appears first so gets SPEAKER_00, Bob gets SPEAKER_01
      expect(result.canonicalSpeakers[0].label).toMatch(/Alice/);
      expect(result.canonicalSpeakers[1].label).toMatch(/Bob/);
      expect(result.canonicalSpeakers[0].label).toMatch(/SPEAKER_00/);
      expect(result.canonicalSpeakers[1].label).toMatch(/SPEAKER_01/);
    });

    it('merging shifts subsequent IDs correctly', () => {
      // Eugene appears in both segments; Carol only in seg1
      // Appearance order: Eugene (seg0), Carol (seg1)
      const seg0 = makePass1(
        0,
        [makeSpeakerInfo('SPEAKER_00 (Eugene)', '')],
        [makeEntry('SPEAKER_00 (Eugene)')],
      );
      const seg1 = makePass1(
        1,
        [
          makeSpeakerInfo('SPEAKER_01 (Eugene)', ''),
          makeSpeakerInfo('SPEAKER_00 (Carol)', ''),
        ],
        [makeEntry('SPEAKER_01 (Eugene)'), makeEntry('SPEAKER_00 (Carol)')],
      );

      const result = reconcileSpeakers({ pass1Results: [seg0, seg1] });

      // SPEAKER_00 → Eugene (first seen in seg0)
      // SPEAKER_01 → Carol (first seen in seg1, after Eugene is already known)
      expect(result.canonicalSpeakers).toHaveLength(2);
      expect(result.canonicalSpeakers[0].label).toMatch(/Eugene/);
      expect(result.canonicalSpeakers[1].label).toMatch(/Carol/);
    });
  });

  // Descriptions are collected and stored
  describe('description collection', () => {
    it('attaches descriptions from speaker_summary to canonical speakers', () => {
      const seg0 = makePass1(
        0,
        [makeSpeakerInfo('SPEAKER_00 (Alice)', 'host of the show')],
        [makeEntry('SPEAKER_00 (Alice)')],
      );

      const result = reconcileSpeakers({ pass1Results: [seg0] });

      expect(result.canonicalSpeakers[0].descriptions).toContain('host of the show');
    });

    it('merges descriptions when the same named speaker appears in multiple segments', () => {
      const seg0 = makePass1(
        0,
        [makeSpeakerInfo('SPEAKER_00 (Eugene)', 'backend lead')],
        [makeEntry('SPEAKER_00 (Eugene)')],
      );
      const seg1 = makePass1(
        1,
        [makeSpeakerInfo('SPEAKER_01 (Eugene)', 'speaks about infra')],
        [makeEntry('SPEAKER_01 (Eugene)')],
      );

      const result = reconcileSpeakers({ pass1Results: [seg0, seg1] });

      const eugeneCanon = result.canonicalSpeakers.find(s => /Eugene/i.test(s.label));
      expect(eugeneCanon).toBeDefined();
      expect(eugeneCanon!.descriptions).toContain('backend lead');
      expect(eugeneCanon!.descriptions).toContain('speaks about infra');
    });
  });

  // Labels appearing only in transcript_entries (not in speaker_summary)
  describe('transcript-only speaker labels', () => {
    it('includes labels that appear only in transcript_entries', () => {
      const seg0 = makePass1(
        0,
        [], // no speaker_summary
        [makeEntry('SPEAKER_00 (Dave)')],
      );

      const result = reconcileSpeakers({ pass1Results: [seg0] });

      expect(result.mapping['0:SPEAKER_00 (Dave)']).toBeDefined();
      expect(result.canonicalSpeakers).toHaveLength(1);
      expect(result.canonicalSpeakers[0].label).toMatch(/Dave/);
    });
  });

  // Mixed named + unnamed in multiple segments
  describe('mixed named and unnamed speakers across segments', () => {
    it('groups named speakers and keeps unnamed separate', () => {
      const seg0 = makePass1(
        0,
        [
          makeSpeakerInfo('SPEAKER_00 (Alice)', 'named'),
          makeSpeakerInfo('SPEAKER_01', 'unnamed A'),
        ],
        [makeEntry('SPEAKER_00 (Alice)'), makeEntry('SPEAKER_01')],
      );
      const seg1 = makePass1(
        1,
        [
          makeSpeakerInfo('SPEAKER_01 (Alice)', 'same Alice'),
          makeSpeakerInfo('SPEAKER_00', 'unnamed B'),
        ],
        [makeEntry('SPEAKER_01 (Alice)'), makeEntry('SPEAKER_00')],
      );

      const result = reconcileSpeakers({ pass1Results: [seg0, seg1] });

      // Alice from both segments → same canonical
      const aliceCanon0 = result.mapping['0:SPEAKER_00 (Alice)'];
      const aliceCanon1 = result.mapping['1:SPEAKER_01 (Alice)'];
      expect(aliceCanon0).toBe(aliceCanon1);

      // Unnamed speakers are distinct
      const unnamed0 = result.mapping['0:SPEAKER_01'];
      const unnamed1 = result.mapping['1:SPEAKER_00'];
      expect(unnamed0).not.toBe(unnamed1);

      // Total: Alice + unnamed0 + unnamed1 = 3
      expect(result.canonicalSpeakers).toHaveLength(3);
    });
  });
});
