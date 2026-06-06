import type { PipelineResult, SegmentResult, SynthesisResult } from '../types/index.js';
import { formatTime, parseTimestamp } from '../lib/utils.js';

interface TimestampContext {
  durationSeconds?: number;
  segmentStartSeconds?: number;
  segmentEndSeconds?: number;
}

function parseNumericParts(ts: string): number[] | null {
  const parts = ts.trim().split(':').map((p) => Number(p.trim().replace(/s$/i, '')));
  if (parts.length === 0 || parts.some((p) => !Number.isFinite(p))) return null;
  return parts;
}

function isWithin(value: number, start?: number, end?: number): boolean {
  const lowerOk = start == null || value >= start - 1;
  const upperOk = end == null || value <= end + 1;
  return lowerOk && upperOk;
}

export function parseTimeRange(range?: string | null): { start?: number; end?: number } {
  if (range == null) return {};
  const parts = range.split(/\s*-\s*/);
  if (parts.length !== 2) return {};
  return {
    start: parseTimestamp(parts[0]),
    end: parseTimestamp(parts[1]),
  };
}

export function normalizeTimestamp(ts: string, context: TimestampContext = {}): string {
  const trimmed = ts.trim();
  if (trimmed === '') return ts;

  const parts = parseNumericParts(trimmed);
  if (parts == null) return ts;

  const parsed = parseTimestamp(trimmed);
  const { durationSeconds, segmentStartSeconds, segmentEndSeconds } = context;

  if (
    (segmentStartSeconds != null || segmentEndSeconds != null)
      ? isWithin(parsed, segmentStartSeconds, segmentEndSeconds)
      : durationSeconds == null || parsed <= durationSeconds + 1
  ) {
    return formatTime(parsed);
  }

  if (parts.length === 3) {
    const [first, second, third] = parts;
    const mmssCandidate = first * 60 + second;
    const isLikelyMmSsFrames =
      first > 0 &&
      second >= 0 &&
      second < 60 &&
      third >= 0 &&
      third < 100;

    if (isLikelyMmSsFrames) {
      if (isWithin(mmssCandidate, segmentStartSeconds, segmentEndSeconds)) {
        return formatTime(mmssCandidate);
      }

      if (
        segmentStartSeconds != null &&
        segmentEndSeconds != null &&
        mmssCandidate <= Math.max(0, segmentEndSeconds - segmentStartSeconds) + 1
      ) {
        const relativeCandidate = segmentStartSeconds + mmssCandidate;
        if (durationSeconds == null || relativeCandidate <= durationSeconds + 1) {
          return formatTime(relativeCandidate);
        }
      }

      if (durationSeconds != null && parsed > durationSeconds && mmssCandidate <= durationSeconds + 1) {
        return formatTime(mmssCandidate);
      }
    }
  }

  if (
    parts.length === 2 &&
    segmentStartSeconds != null &&
    segmentEndSeconds != null &&
    parsed < segmentStartSeconds - 1
  ) {
    const relativeCandidate = segmentStartSeconds + parsed;
    if (relativeCandidate <= segmentEndSeconds + 1 && (durationSeconds == null || relativeCandidate <= durationSeconds + 1)) {
      return formatTime(relativeCandidate);
    }
  }

  return formatTime(parsed);
}

export function normalizeSegmentResultTimestamps(segment: SegmentResult, durationSeconds: number): void {
  const pass1Range = parseTimeRange(segment.pass1?.time_range);
  const pass2Range = parseTimeRange(segment.pass2?.time_range);
  const segmentStartSeconds = pass2Range.start ?? pass1Range.start;
  const segmentEndSeconds = pass2Range.end ?? pass1Range.end;
  const context = { durationSeconds, segmentStartSeconds, segmentEndSeconds };

  if (segment.pass1 != null) {
    for (const entry of segment.pass1.transcript_entries ?? []) {
      entry.timestamp = normalizeTimestamp(entry.timestamp, context);
    }
  }

  if (segment.pass2 != null) {
    for (const block of segment.pass2.code_blocks ?? []) {
      block.timestamp = normalizeTimestamp(block.timestamp, context);
      if (block.timestamp_end != null) block.timestamp_end = normalizeTimestamp(block.timestamp_end, context);
    }
    for (const note of segment.pass2.visual_notes ?? []) {
      note.timestamp = normalizeTimestamp(note.timestamp, context);
    }
    for (const state of segment.pass2.screen_timeline ?? []) {
      state.timestamp = normalizeTimestamp(state.timestamp, context);
    }
    for (const region of segment.pass2.visual_regions ?? []) {
      region.timestamp = normalizeTimestamp(region.timestamp, context);
    }
  }

  if (segment.pass3c != null) {
    for (const message of segment.pass3c.messages ?? []) {
      message.timestamp = normalizeTimestamp(message.timestamp, context);
    }
    for (const link of segment.pass3c.links ?? []) {
      link.timestamp = normalizeTimestamp(link.timestamp, context);
    }
  }

  if (segment.pass3d != null) {
    for (const shift of segment.pass3d.emotional_shifts ?? []) {
      shift.timestamp = normalizeTimestamp(shift.timestamp, context);
    }
    for (const task of segment.pass3d.tasks_assigned ?? []) {
      task.timestamp = normalizeTimestamp(task.timestamp, context);
    }
    for (const pattern of segment.pass3d.emphasis_patterns ?? []) {
      pattern.timestamps = (pattern.timestamps ?? []).map((ts) => normalizeTimestamp(ts, context));
    }
  }
}

export function normalizeSynthesisTimestamps(synthesis: SynthesisResult | undefined, durationSeconds: number): void {
  if (synthesis == null) return;
  const context = { durationSeconds };

  for (const decision of synthesis.key_decisions ?? []) {
    decision.timestamp = normalizeTimestamp(decision.timestamp, context);
  }
  for (const concept of synthesis.key_concepts ?? []) {
    concept.timestamp = normalizeTimestamp(concept.timestamp, context);
  }
  for (const item of synthesis.action_items ?? []) {
    item.timestamp = normalizeTimestamp(item.timestamp, context);
  }
  for (const question of synthesis.questions_raised ?? []) {
    question.timestamp = normalizeTimestamp(question.timestamp, context);
  }
  for (const topic of synthesis.topics ?? []) {
    topic.timestamps = (topic.timestamps ?? []).map((ts) => normalizeTimestamp(ts, context));
  }
  for (const prerequisite of synthesis.prerequisites ?? []) {
    prerequisite.timestamp_first_assumed = normalizeTimestamp(prerequisite.timestamp_first_assumed, context);
  }
}

export function normalizePipelineTimestamps(result: PipelineResult, durationSeconds: number): PipelineResult {
  for (const segment of result.segments) {
    normalizeSegmentResultTimestamps(segment, durationSeconds);
  }
  normalizeSynthesisTimestamps(result.synthesisResult, durationSeconds);
  return result;
}
