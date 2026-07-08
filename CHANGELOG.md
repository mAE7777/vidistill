# Changelog

## [0.9.1] - 2026-07-07

### Added
- `repository`, `homepage`, and `bugs` metadata in package.json, plus expanded keywords (mcp, model-context-protocol, claude, youtube, obsidian) for registry discoverability
- Continuous integration running the build and full test suite on every push

### Changed
- README leads with badges and a broader intro covering lectures, talks, demos, and meetings, not just coding tutorials
- Sharpened package description

## [0.9.0] - 2026-06-06

### Added
- Clip-based processing for long videos — local files and downloaded URLs over 25 minutes are split into 20-minute clips (30-second overlap) via ffmpeg, uploaded and processed in parallel across 4 lanes, with all timestamps mapped back to the original video timeline
- Visual region detection — scene analysis now identifies on-screen regions (chat panels, comment sidebars) with bounding boxes; detected regions decide whether the chat pass runs and guide which frames are captured as chat screenshots
- Bare-domain link detection — links.md now catches `www.` and bare-domain mentions (e.g. `example.com`) alongside full URLs, normalized to https
- Pre-pipeline cost estimates account for clip-based runs (per-clip pass counts and upload overhead)

### Changed
- Non-YouTube URLs download first, then route through the same split-or-upload decision as local files (previously uploaded directly without a local copy)
- MCP `analyze_video` routes long local and remote videos through the clip pipeline, same as the CLI
- Keyframe timestamp selection prefers detected chat regions when choosing chat screenshots

### Fixed
- Keyframe extraction no longer crashes when Gemini responses omit `screen_timeline` or `visual_notes` fields

### Dependencies
- `@google/genai` ^1.52.0, `@modelcontextprotocol/sdk` ^1.29.0 — clears all known audit advisories in the dependency tree (35 resolved, including 1 critical and 7 high)

## [0.8.0] - 2026-04-20

### Added
- Non-YouTube URL support — any yt-dlp-supported site (Vimeo, Bilibili, etc.) downloads, extracts metadata, and processes through the full pipeline
- Batch processing — `--batch <file>` processes multiple videos sequentially with per-item error isolation and an `index.md` summary
- Keyframe extraction — extracts visual keyframes (slides, diagrams, whiteboard changes) from local video files via ffmpeg, embedded as screenshots in combined.md
- 5 new MCP tools: `get_notes`, `get_people`, `get_action_items`, `get_links`, `get_chat` — full knowledge graph exposed through the MCP server (8 tools total)
- Pre-pipeline cost estimate — shows predicted API calls and time range before processing, with confirmation prompt
- Post-pipeline quality summary — transcript coverage, code file count, speaker count, consensus rate, dedup removals, token usage
- `--quick` / `-q` mode — skips consensus, implicit, people, and dedup passes for ~60% fewer API calls
- `--format obsidian` — adds YAML frontmatter and wikilinks to all markdown output
- `vidistill list` command — scans output directories and displays a metadata table
- Fuzzy speaker reconciliation — Jaccard token overlap with temporal non-overlap guards for cross-segment speaker merging ("Dr. Sarah Chen" and "Sarah Chen")
- Transcript URL fallback — links.md now scans transcript text for URLs when pass3c doesn't run
- Token usage tracking in metadata.json — input/output token counts and API call metrics

### Changed
- README rewritten to lead with coding tutorial use case and MCP quick-start
- Combined.md filters speech entries with >60% overlap against synthesis notes
- LM dedup refactored from monolithic Gemini call to chunked 200-entry windows with overlap
- Deprecated monolithic transcript pass removed (replaced by consensus pipeline in 0.5.0)

### Fixed
- Gemini responses with undefined `text` fields no longer crash transcript consensus (`toLowerCase` on undefined)
- Remote URL handler resolves system yt-dlp binary explicitly — `ytdlp-nodejs` bundled binary unreliable in tsup bundle
- MCP `analyze_video` threads `inputFilePath` for local file keyframe extraction
- ffmpeg keyframe extraction uses `-y` flag to overwrite existing frames on re-runs
- `getPeople` guards against malformed JSON missing `participants` key
- `getLinks` catch narrowed to ENOENT only — non-file-not-found errors no longer silently swallowed
- `tokenUsage` preserved through rename-speakers re-render (was silently dropped from metadata.json)
- Consensus run constants shared between estimator and pipeline (eliminates drift risk)
- Fractional seconds rounded in `vidistill list` and obsidian frontmatter duration display
- Invalid `--format` values now rejected with error message instead of silently producing standard output
- URL trailing punctuation stripping no longer removes `+` (fixes C++ reference URLs)
- Union-find path compression in speaker reconciliation

## [0.7.0] - 2026-03-07

### Added
- Boundary overlap trimming — detects and trims overlapping text at transcript entry boundaries using sequential word matching (5+ consecutive words), eliminating partial duplication that set-based dedup couldn't catch
- Cross-segment boundary dedup in combined.md — was previously only applied to transcript.md

### Fixed
- Transcript entries with ~50-60% boundary overlap (suffix of entry N repeated as prefix of entry N+1) no longer produce duplicated text in output
- Case-insensitive transcript dedup — "Empire" and "empire" now correctly match as near-duplicates
- Asymmetric dedup — shorter entries that are subsets of longer entries are properly detected and removed
- Single-run transcription mode now applies dedup and boundary trimming (was returning raw Gemini output)
- Action items dedup, YouTube metadata extraction, emphasis word filtering, and commentary type classification improvements
- Timeline output removed (was low-value HTML file)

## [0.6.3] - 2026-03-07

### Added
- LM-based transcript deduplication — uses Gemini to identify semantic duplicates across the assembled transcript (same meaning, different wording)
- Cross-segment boundary deduplication — removes near-duplicate entries where segments overlap

## [0.6.2] - 2026-03-07

### Fixed
- README MCP setup instructions now use `claude mcp add` instead of a non-existent config file

## [0.6.1] - 2026-03-07

### Fixed
- MCP server no longer outputs CLI logo and intro text that corrupts the stdio protocol

## [0.6.0] - 2026-03-07

### Added
- MCP server (`vidistill mcp`) — exposes `analyze_video`, `get_transcript`, and `get_code` tools for AI assistant integration via stdio transport
- Optional output folder name prompt — YouTube videos no longer stuck with opaque `youtube-{videoId}` folder names
- YouTube duration detection via HTML scraping fallback when yt-dlp is not installed, preventing silent transcript truncation at 10 minutes
- Prerequisites section in guide.md — knowledge prerequisites extracted from synthesis, grouped by level

### Changed
- Insights and prereqs merged into notes.md and guide.md — low-signal standalone files (insights.md, prereqs.md) removed; valuable content (implicit decisions, questions, recurring themes, prerequisites) preserved in existing files

### Fixed
- **Transcript quality**: Near-identical duplicate entries from Gemini (same text, timestamps 2-10s apart) now deduplicated; transient consensus run failure warnings no longer shown to users
- **Speaker naming**: people.md now properly updates names during `rename-speakers` (was skipping non-SPEAKER_XX participant names)
- **YouTube handling**: Duration detection no longer silently defaults to 600s when yt-dlp is unavailable — HTML fallback added
- **MCP server**: Fixed typecheck error from readdir overload, added stderr logging to duration fallback catch, rewrote tests to invoke actual functions instead of testing mock return values
- **Pipeline**: Dead code removed from progress display; `.gitignore` updated; schema validation tightened for diarization pass
- **Consensus**: Individual run failure warnings suppressed from user output (transient errors handled by consensus mechanism); early return guard added for invalid runs config

## [0.5.0] - 2026-03-05

### Added
- 3-run transcript consensus — transcription (1a) and diarization (1b) each run 3 times per segment with alignment-based merging and majority voting for speaker labels
- Decoupled transcription pipeline — split monolithic Pass 1 into focused Pass 1a (pure transcription) and Pass 1b (speaker diarization) with a deterministic merge step
- Cross-segment speaker reconciliation — normalizes speaker labels across segments so the same person gets a single canonical ID regardless of which segment they appear in
- People anchoring — extraction constrained to transcript-confirmed speakers, preventing hallucinated participants from visual-only sources
- Non-interactive progress fallback — stable log output when stdout isn't a TTY (avoids animated progress flooding in piped/CI contexts)

### Changed
- Temperature set to 1.0 for all gemini-3-flash-preview passes (transcript, visual, chat, people) per Google Gemini 3 recommendation — 0.0 caused erratic behavior
- Per-segment API calls increased from 3 to 7 (3x transcription + 3x diarization + 1x visual) for consensus coverage
- Speaker name replacement now applied to all free-text content across output files, not just structured fields

### Fixed
- YouTube direct URL mode no longer crashes when duration is unavailable — fetches metadata via yt-dlp if installed, falls back to 600s default
- Diarization gracefully degrades on failure — preserves transcript with SPEAKER_UNKNOWN labels instead of crashing
- Empty catch blocks in consensus now log warnings instead of silently discarding errors
- Consensus config.runs validated against 0 and negative values
- Dead code removed from progress display and pipeline test mocks
- SCHEMA_PASS_1B speaker_summary items now include required field array

## [0.4.4] - 2026-03-03

### Fixed
- README updated to remove references to deleted resume feature and post-pipeline speaker naming prompt

## [0.4.3] - 2026-03-03

### Changed
- Consensus run failure messages no longer clutter user output — only final summary logged on total failure

### Removed
- Resume feature — progress file detection and resume prompt removed from pipeline
- Post-pipeline speaker naming prompt — use `vidistill rename-speakers` instead
- Extract tip from completion output (extract command was removed in 0.4.0)

## [0.4.2] - 2026-03-02

### Fixed
- Resume prompt no longer hangs when progress file exists but has zero completed passes
- Null guard on Gemini response fields (`code_blocks`, `visual_notes`) prevents crashes when API returns undefined arrays
- Consensus loops skip entries with missing `filename` or `url` fields instead of crashing

## [0.4.1] - 2026-03-02

### Added
- `rename-speakers` v2 — `--rename`, `--merge`, and `--list` flags for quick non-interactive speaker renaming and identity merging
- Merge detection — prompts to merge similar speaker identities (e.g. "K Iphone" and "Kang") during interactive naming
- People deduplication — merged speakers consolidate speaking segments, contributions, and contact info

### Fixed
- Speaker names now resolve across all output files via expanded mapping — handles SPEAKER_XX prefixes, parenthetical annotations, and case-insensitive detected names
- `rename-speakers --rename` rejects flags-as-values and insufficient arguments
- Empty/whitespace speaker names rejected during interactive rename
- Inner quotes in speaker names properly escaped in formatted name lists
- Unsafe `as string` casts replaced with typeof guards in speaker naming and rename flows
- `declinedMerges` correctly passed through to people writer during output generation

## [0.4.0] - 2026-03-02

### Added
- Speaker naming — post-pipeline prompt assigns real names to detected SPEAKER_XX labels, re-renders all affected output files
- `rename-speakers` command — standalone command to re-name speakers on existing output directories
- Pipeline resume — interrupted runs save progress after each pass; re-running the same output directory offers to resume from where it left off
- Interactive HTML timeline — color-coded lanes for speech, code, visuals, and key moments with dark mode support
- Prerequisites output — extracts knowledge prerequisites from synthesis, grouped by knowledge level (beginner, intermediate, advanced)
- Link consensus voting — chat extraction runs 3x per segment, keeps only links appearing in 2+ runs to filter hallucinated URLs

### Changed
- Version access uses build-time injection (`VIDISTILL_VERSION`) instead of runtime `createRequire` file resolution

### Removed
- `extract` command — bypassed quality layers (synthesis, deduplication, consensus) and exposed LLM non-determinism across extraction methods
- Unused placeholder subcommands (ask, search, watch)

### Fixed
- Speaker names now applied consistently across all output files including combined.md
- YouTube URLs sent directly to Gemini instead of always falling back to yt-dlp
- CLI binary crash on startup — `createRequire` resolved relative path from wrong location after tsup bundling
- `parseSemver` NaN bug causing false version mismatch warnings on resume
- Pipeline strategy not tracked in progress file during fresh runs
- Unsafe type casts on preloaded results and JSON reads replaced with runtime object validation
- Progress file validation rejects malformed schema version, vidistill version, and completed passes fields
- Duplicate `readJsonFile` implementations consolidated into shared utility

## [0.2.5] - 2026-03-01

### Fixed
- Subcommands (extract, ask, search, etc.) now work in published package — replaced dynamic `import()` with static imports so tsup includes them in the bundle

## [0.2.4] - 2026-03-01

### Added
- Audio file support — MP3, WAV, FLAC, OGG, M4A, AAC detected via magic bytes, skips video-specific processing
- `vidistill extract` command — pull transcript, code, links, people, or notes from existing output or directly from video without full pipeline
- Multi-language output — `--lang` flag threads language instructions through all extraction passes

### Fixed
- `withLanguage()` guards against empty string language parameter
- AAC ADTS format detection added (was missing from audio detection)
- MP3 sync word broadened to cover all MPEG audio frame variants
- Audio profiles no longer run code pass (requires visual data)
- `extract` command validates parsed JSON before casting
- `distill` peekIsAudio synced with broadened audio detection

## [0.2.3] - 2026-02-28

### Fixed
- Progress bar and spinner now properly stop on pipeline completion (was a no-op leaving them hanging)
- Progress bar `start()` called with initial label for immediate visual feedback

## [0.2.2] - 2026-02-28

### Fixed
- `--version` flag now works (`vidistill --version` outputs version number)

## [0.2.1] - 2026-02-28

### Added
- Subcommand architecture — `vidistill distill` with manual dispatch, supports both `vidistill video.mp4` and `vidistill <command>` patterns
- Confirmation loop before pipeline execution — shows config box, lets user change input/context/output before proceeding
- Two-phase progress display: spinner for scene analysis (indeterminate), progress bar for main pipeline (deterministic step counting)
- Clean completion output with contextual tips based on pipeline results
- Informative interruption messages showing completed step count on Ctrl+C

### Changed
- CLI entry point refactored from monolith to `src/commands/distill.ts` with root dispatcher
- Config display uses `@clack/prompts note()` boxed layout
- Progress display no longer shows internal details (video type, strategy, segment count) — only progress bar, completion summary, and errors
- Confirmation prompt skipped when all inputs provided via CLI flags
- `@clack/prompts` upgraded from `^0.9.1` to `1.0.1` (exact pin)
- Pipeline emits per-consensus-run progress events instead of single combined event

### Fixed
- Interrupted pipeline no longer shows contradictory "Done in..." message after Ctrl+C
- Unsafe `as { run: ... }` cast on dynamic subcommand import replaced with runtime validation
- Force-exit SIGINT handler properly deregistered to prevent listener leaks
- `@clack/prompts` v1.0 `validate` callback guard for `string | undefined`

## [0.2.0] - 2026-02-28

### Added
- Multi-run consensus voting for code reconstruction — 3 independent runs, 2-agreement threshold eliminates hallucinated files
- 5-gate validation pipeline for extracted code: structural integrity, filesystem safety, cross-reference, consensus agreement, content quality
- Whole-video code reconstruction — processes entire video as a single pass instead of per-segment
- Pro-tier model (Gemini 2.5 Pro) for code reconstruction and synthesis; flash tier for extraction
- Deterministic output file routing — generated files determined by pass data presence, not LLM suggestions
- Uncertain file markers in code output for consensus-passing files without screen observation cross-reference
- Context compilation with temporal segment headers for multi-segment videos

### Changed
- Code pass runs once after all segments complete (previously per-segment with merge)
- Temperature tuned per pass: 0.0 for extraction, 0.1 for reasoning, 0.2 for scene analysis
- Model constants refactored from array indexing to named object (`MODELS.flash`, `MODELS.pro`)
- Code context truncation prioritizes code-bearing segments and truncates at newline boundaries

### Fixed
- Runtime validation for YouTube oEmbed API responses replaces unsafe type cast
- Error messages sanitized to cap length and prevent internal detail leakage
- Duplicate filename normalization logic extracted to shared utility
- Unicode-aware tokenizer for consensus content selection (was ASCII-only)
- Consensus config unified as single source of truth in pipeline orchestrator
- Dead code removed: unused segmentIndex field, unnecessary type casts, stale optional chaining

## [0.1.1] - 2026-02-28

### Fixed
- Code pass now runs for any video type when code is visible on screen, not just coding/mixed types
- Guide.md files table shows actually generated files instead of synthesis wishes that may not exist
- Synthesis code filenames (e.g. `views.py`, `test_assembler.py`) correctly trigger the code writer

## [0.1.0] - 2026-02-28

Initial release.

### Added
- CLI with interactive and direct modes (`vidistill` or `vidistill <url>`)
- YouTube URL support with direct Gemini processing and yt-dlp fallback
- Local video file support with magic bytes validation, MKV conversion, and >2GB compression
- API key resolution chain: environment variable, config file (~/.vidistill/config.json), interactive prompt
- Pass 0 scene analysis — classifies video type and adapts processing strategy
- Pass 1 transcript extraction with speaker identification and timestamps
- Pass 2 visual extraction (screen states, diagrams, slides) with transcript context injection
- Specialist passes dispatched by video type:
  - Code reconstruction for coding tutorials and demos
  - People and social dynamics extraction for meetings
  - Chat and links extraction for live streams
  - Implicit signals (tone, emphasis, emotional shifts) for all types
- Synthesis pass that cross-references all extracted data into structured notes
- Adaptive strategy router mapping 6 video types to optimal pass combinations
- Duration-based video segmentation with 4-tier rules and resolution recommendations
- 10 structured markdown output writers: guide, transcript, combined, code, notes, people, chat, links, action items, insights
- JSON metadata and raw pass output preservation
- Graceful shutdown (Ctrl+C) with Gemini file cleanup and partial output saving
- Error cascade handling — synthesis failure falls back to raw pass data, individual writer errors don't abort other outputs
- Rate limiting with configurable backoff for Gemini API calls
- Live progress spinner with per-pass status updates

### Fixed
- Config file validation rejects non-object and non-string API key values
- Config directory created with 0o700 permissions for security
- Temp filenames include random component to prevent collisions
- Segmenter handles non-finite and negative duration inputs without OOM
- formatTime handles NaN, negative, and Infinity inputs gracefully
- Scene analysis validates nested response fields before casting
- Pipeline passesRun accurately reflects which passes succeeded, not just which were attempted
- All specialist passes validate secondary array fields in Gemini responses
- Shared parseTimestamp utility eliminates duplicate parsing logic
- Dead code and unused parameters removed from output generators
