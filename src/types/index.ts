import { type MediaResolution } from '@google/genai';
import type { GeminiClient } from '../gemini/client.js';
import type { RateLimiter } from '../gemini/rate-limiter.js';

// Data Structures for Gemini Responses
export interface TranscriptEntry {
  timestamp: string;
  speaker: string;
  text: string;
  tone: string;
  emphasis_words?: string[];
  pause_after_seconds?: number;
}

export interface SpeakerInfo {
  speaker_id: string;
  description: string;
}

export interface Pass1Result {
  segment_index: number;
  time_range: string;
  transcript_entries: TranscriptEntry[];
  speaker_summary: SpeakerInfo[];
}

export interface Pass1aEntry {
  timestamp: string;
  text: string;
  tone: string;
  emphasis_words?: string[];
  pause_after_seconds?: number;
}

export interface Pass1aResult {
  segment_index: number;
  time_range: string;
  transcript_entries: Pass1aEntry[];
}

export interface SpeakerAssignment {
  timestamp: string;
  speaker: string;
}

export interface Pass1bResult {
  speaker_assignments: SpeakerAssignment[];
  speaker_summary: SpeakerInfo[];
}

export interface CodeBlock {
  timestamp: string;
  timestamp_end?: string;
  filename: string;
  language: string;
  content: string;
  screen_type: string;
  change_type: string;
  lines_changed?: string;
  instructor_explanation: string;
}

export interface VisualNote {
  timestamp: string;
  visual_type: string;
  description: string;
}

export interface ScreenState {
  timestamp: string;
  screen_state: string;
}

export interface Pass2Result {
  segment_index: number;
  time_range: string;
  code_blocks: CodeBlock[];
  visual_notes: VisualNote[];
  screen_timeline: ScreenState[];
}

// Meeting Notes types
export interface MeetingNotesDecision { decision: string; timestamp: string; context: string; }
export interface MeetingNotesConcept { concept: string; explanation: string; timestamp: string; }
export interface MeetingNotesActionItem { item: string; timestamp: string; mentioned_by: string; }
export interface MeetingNotesQuestion { question: string; timestamp: string; answered: boolean; }
export interface MeetingNotesTopic { title: string; timestamps: string[]; summary: string; key_points: string[]; }
export interface MeetingNotesResult {
  overview: string;
  key_decisions: MeetingNotesDecision[];
  key_concepts: MeetingNotesConcept[];
  action_items: MeetingNotesActionItem[];
  questions_raised: MeetingNotesQuestion[];
  suggestions: string[];
  topics: MeetingNotesTopic[];
}

// New pipeline types
export type VideoType = 'coding' | 'meeting' | 'lecture' | 'presentation' | 'conversation' | 'commentary' | 'mixed' | 'audio';
export type ComplexityLevel = 'simple' | 'moderate' | 'complex';

export interface VideoProfileVisualContent {
  hasCode: boolean;
  hasSlides: boolean;
  hasDiagrams: boolean;
  hasPeopleGrid: boolean;
  hasChatbox: boolean;
  hasWhiteboard: boolean;
  hasTerminal: boolean;
  hasScreenShare: boolean;
}

export interface VideoProfileAudioContent {
  hasMultipleSpeakers: boolean;
  primaryLanguage: string;
  quality: 'high' | 'medium' | 'low';
}

export interface VideoProfileRecommendations {
  resolution: 'low' | 'medium' | 'high';
  segmentMinutes: number;
  /** Informational only — populated by Gemini but not consumed by the strategy router. */
  passes: string[];
}

export interface VideoProfile {
  type: VideoType;
  speakers: { count: number; identified: string[] };
  visualContent: VideoProfileVisualContent;
  audioContent: VideoProfileAudioContent;
  complexity: ComplexityLevel;
  recommendations: VideoProfileRecommendations;
}

export interface PassStrategy {
  passes: string[];
  resolution: string;
  segmentMinutes: number;
}

export interface CodeChange {
  timestamp: string;
  change_type: string;
  description: string;
  diff_summary: string;
}

export interface CodeFile {
  filename: string;
  language: string;
  final_content: string;
  changes: CodeChange[];
}

export interface CodeReconstruction {
  files: CodeFile[];
  dependencies_mentioned: string[];
  build_commands: string[];
}

export interface Participant {
  name: string;
  role: string;
  organization: string;
  speaking_segments: string[];
  contact_info: string[];
  contributions: string[];
}

export interface PeopleExtraction {
  participants: Participant[];
  relationships: string[];
}

export interface ChatMessage {
  timestamp: string;
  sender: string;
  text: string;
}

export interface ExtractedLink {
  url: string;
  context: string;
  timestamp: string;
}

export interface ChatExtraction {
  messages: ChatMessage[];
  links: ExtractedLink[];
}

export interface EmotionalShift {
  timestamp: string;
  from_state: string;
  to_state: string;
  trigger: string;
}

export interface TaskAssigned {
  timestamp: string;
  assignee: string;
  task: string;
  deadline: string;
}

export interface EmphasisPattern {
  concept: string;
  times_mentioned: number;
  timestamps: string[];
  significance: string;
}

export interface ImplicitSignals {
  emotional_shifts: EmotionalShift[];
  questions_implicit: string[];
  decisions_implicit: string[];
  tasks_assigned: TaskAssigned[];
  emphasis_patterns: EmphasisPattern[];
}

export interface PrerequisiteConcept {
  concept: string;
  assumed_knowledge_level: 'basic' | 'intermediate' | 'advanced';
  brief_explanation: string;
  timestamp_first_assumed: string;
}

export interface SynthesisResult {
  overview: string;
  key_decisions: MeetingNotesDecision[];
  key_concepts: MeetingNotesConcept[];
  action_items: MeetingNotesActionItem[];
  questions_raised: MeetingNotesQuestion[];
  suggestions: string[];
  topics: MeetingNotesTopic[];
  files_to_generate: string[];
  prerequisites: PrerequisiteConcept[];
}

export interface PipelineConfig {
  apiKey: string;
  model: string;
  outputDir: string;
  context?: string;
}

export interface ProgressStatus {
  phase: string;
  segment: number;
  totalSegments: number;
  status: string;
  currentStep?: number;
  totalSteps?: number;
}

export interface SegmentResult {
  index: number;
  pass1: Pass1Result | null;
  pass2: Pass2Result | null;
  pass3c?: ChatExtraction | null;
  pass3d?: ImplicitSignals | null;
}

export interface TokenUsage {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
}

export interface CostEstimate {
  totalCalls: number;
  estimatedMinutes: [number, number];
}

export interface PipelineResult {
  segments: SegmentResult[];
  passesRun: string[];
  errors: string[];
  videoProfile?: VideoProfile;
  strategy?: PassStrategy;
  synthesisResult?: SynthesisResult;
  peopleExtraction?: PeopleExtraction | null;
  codeReconstruction?: CodeReconstruction | null;
  uncertainCodeFiles?: string[];
  /** Set when pipeline was interrupted mid-run. Lists pass names that did not complete. */
  interrupted?: string[];
  tokenUsage?: TokenUsage;
  apiCallCount: number;
  consensusAgreementRate?: number;
  dedupRemovalCount?: number;
}

export interface PassResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface Segment {
  index: number;
  startTime: number;
  endTime: number;
}

export interface RunPipelineConfig {
  client: GeminiClient;
  fileUri: string;
  mimeType: string;
  duration: number;
  model: string;
  resolution?: MediaResolution;
  context?: string;
  lang?: string;
  channelAuthor?: string;
  rateLimiter: RateLimiter;
  onProgress?: (status: ProgressStatus) => void;
  onWait?: (delayMs: number) => void;
  isShuttingDown?: () => boolean;
  onPass0Complete?: (profile: VideoProfile, strategy: PassStrategy, segmentCount: number) => Promise<boolean>;
  quick?: boolean;
}

export interface GenerateOutputParams {
  pipelineResult: PipelineResult;
  outputDir: string;
  videoTitle: string;
  source: string;
  duration: number;
  model: string;
  processingTimeMs: number;
  channelAuthor?: string;
  speakerMapping?: SpeakerMapping;
  declinedMerges?: [string, string][];
  keyframes?: Array<{ timestamp: string; path: string; description: string }>;
  inputFilePath?: string;
  format?: 'standard' | 'obsidian';
}

export interface ReRenderWithSpeakerMappingParams {
  outputDir: string;
  speakerMapping: SpeakerMapping;
  declinedMerges?: [string, string][];
  format?: 'standard' | 'obsidian';
}

export interface OutputResult {
  outputDir: string;
  filesGenerated: string[];
  errors: string[];
}

export type SpeakerMapping = Record<string, string>;

export interface CanonicalSpeaker {
  /** Canonical label, e.g. "SPEAKER_00 (Alice)" or "SPEAKER_02" */
  label: string;
  /** Descriptions collected from speaker_summary entries across all segments */
  descriptions: string[];
}

export interface ReconciliationResult {
  /**
   * Maps each original per-segment speaker label to its canonical label.
   * Key format: `${segmentIndex}:${originalLabel}` (e.g. "0:SPEAKER_00 (Eugene)").
   * Value: canonical label (e.g. "SPEAKER_00 (Eugene)").
   */
  mapping: Record<string, string>;
  /** Ordered list of canonical speakers, by first appearance. */
  canonicalSpeakers: CanonicalSpeaker[];
}
