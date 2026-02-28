# Changelog

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
