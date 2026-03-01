# Changelog

## [0.2.0] - 2026-02-28

### Added
- Subcommand architecture — `vidistill distill` with manual dispatch, supports both `vidistill video.mp4` and `vidistill <command>` patterns
- Confirmation loop before pipeline execution — shows config box, lets user change input/context/output before proceeding
- Two-phase progress display: spinner for scene analysis (indeterminate), progress bar for main pipeline (deterministic step counting)
- Clean completion output with contextual tips based on pipeline results
- Informative interruption messages showing completed step count on Ctrl+C
- Multi-run consensus voting for code reconstruction — 3 independent runs, 2-agreement threshold eliminates hallucinated files
- 5-gate validation pipeline for extracted code: structural integrity, filesystem safety, cross-reference, consensus agreement, content quality
- Whole-video code reconstruction — processes entire video as a single pass instead of per-segment
- Pro-tier model (Gemini 2.5 Pro) for code reconstruction and synthesis; flash tier for extraction
- Deterministic output file routing — generated files determined by pass data presence, not LLM suggestions
- Uncertain file markers in code output for consensus-passing files without screen observation cross-reference
- Context compilation with temporal segment headers for multi-segment videos

### Changed
- CLI entry point refactored from monolith to `src/commands/distill.ts` with root dispatcher
- Config display uses `@clack/prompts note()` boxed layout
- Progress display no longer shows internal details (video type, strategy, segment count) — only progress bar, completion summary, and errors
- Confirmation prompt skipped when all inputs provided via CLI flags
- `@clack/prompts` upgraded from `^0.9.1` to `1.0.1` (exact pin)
- Code pass runs once after all segments complete (previously per-segment with merge)
- Temperature tuned per pass: 0.0 for extraction, 0.1 for reasoning, 0.2 for scene analysis
- Model constants refactored from array indexing to named object (`MODELS.flash`, `MODELS.pro`)
- Code context truncation prioritizes code-bearing segments and truncates at newline boundaries
- Pipeline emits per-consensus-run progress events instead of single combined event

### Fixed
- Interrupted pipeline no longer shows contradictory "Done in..." message after Ctrl+C
- Unsafe `as { run: ... }` cast on dynamic subcommand import replaced with runtime validation
- Force-exit SIGINT handler properly deregistered to prevent listener leaks
- `@clack/prompts` v1.0 `validate` callback guard for `string | undefined`
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
