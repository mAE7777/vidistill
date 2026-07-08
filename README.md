# vidistill

[![ci](https://github.com/mAE7777/vidistill/actions/workflows/ci.yml/badge.svg)](https://github.com/mAE7777/vidistill/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/vidistill.svg)](https://www.npmjs.com/package/vidistill)
[![license](https://img.shields.io/npm/l/vidistill.svg)](https://github.com/mAE7777/vidistill/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/vidistill.svg)](https://nodejs.org)

Turn long video explanations into a folder your AI editor can read.

vidistill is a CLI and MCP server for distilling YouTube videos, local files, and yt-dlp-supported URLs into structured markdown, transcripts, visual notes, screenshots, reconstructed source files, and speaker-attributed notes.

It is built for videos where the screen matters as much as the audio: coding tutorials, lectures with slides, whiteboard talks, live demos, streams with chat, and technical meetings. Instead of finishing a 40-minute tutorial with a few screenshots and a vague memory, you get a directory with the transcript, visual notes, reconstructed code, a code timeline, links, chat, people, and action items. Point an AI editor at that directory and ask questions against the artifacts.

## MCP Quick-Start

Use vidistill as an MCP server so Claude Code (or any MCP-compatible tool) can analyze videos and query results directly.

```bash
# 1. Install
npm install -g vidistill

# 2. Register the MCP server
claude mcp add vidistill -- npx vidistill mcp

# 3. Ask Claude to analyze a video
#    "Analyze this tutorial and show me the code files"
```

**Available tools:**

| Tool | Description |
|------|-------------|
| `analyze_video` | Run the full pipeline on a URL or file |
| `get_transcript` | Read transcript with optional time range filter |
| `get_code` | Read reconstructed source files |
| `get_notes` | Overview, decisions, concepts, topics |
| `get_people` | Speaker/participant details |
| `get_action_items` | Tasks assigned during the video |
| `get_links` | All URLs mentioned |
| `get_chat` | Chat messages from streams/meetings |

## Before / After

**Input:** a YouTube tutorial URL

**Output:**

```
vidistill-output/react-server-components/
├── guide.md              # overview and navigation
├── transcript.md          # full timestamped transcript
├── combined.md            # transcript + visual notes + screenshots
├── notes.md               # synthesized notes and themes
├── code/                  # reconstructed source files
│   ├── app.tsx
│   ├── server-component.tsx
│   └── code-timeline.md   # code evolution timeline
├── images/                # keyframe screenshots
│   └── frame-*.png
├── people.md              # speakers and participants
├── chat.md                # chat messages and links
├── action-items.md        # tasks and follow-ups
├── links.md               # all URLs mentioned
├── metadata.json          # processing metadata
└── raw/                   # raw pass outputs
```

Which files are generated depends on the content — coding videos get `code/`, meetings get `people.md` and `action-items.md`, etc.

## Usage

```
vidistill [input] [options]
```

| Flag | Description |
|------|-------------|
| `input` | YouTube URL, video URL, local video/audio path (prompted if omitted) |
| `-c, --context` | Context about the video (e.g. "CS lecture") |
| `-o, --output` | Output directory (default: `./vidistill-output/`) |
| `-l, --lang` | Output language (e.g. `zh`, `ja`, `es`) |
| `-b, --batch` | Path to a batch file for processing multiple videos |
| `-q, --quick` | Quick mode — skip consensus for faster results (~60% fewer API calls) |
| `-f, --format` | Output format: `standard` (default) or `obsidian` (YAML frontmatter + wikilinks) |

**Examples:**

```bash
# Interactive mode
vidistill

# YouTube video
vidistill "https://youtube.com/watch?v=dQw4w9WgXcQ"

# Local file with context
vidistill ./lecture.mp4 --context "distributed systems"

# Quick mode — faster, fewer API calls
vidistill ./demo.mp4 --quick

# Obsidian-friendly output
vidistill ./lecture.mp4 --format obsidian

# Non-YouTube URL (Bilibili, Vimeo, Twitter/X, etc.)
vidistill "https://vimeo.com/123456789"

# Batch processing
vidistill --batch videos.txt

# List previous outputs
vidistill list
vidistill list --dir ./custom-output/
```

### Batch Files

One URL or file path per line. Lines starting with `#` are comments. Add context after a `|` separator:

```
# Lectures
https://youtube.com/watch?v=abc|distributed systems
https://vimeo.com/123456|networking basics

# Local files
./recording.mp4|team standup
```

### Listing Outputs

```bash
vidistill list
```

Scans `./vidistill-output/` (or `--dir <path>`) and displays a table of all processed videos with title, duration, type, date, and file count.

## Speaker Naming

When multiple speakers are detected, use `rename-speakers` to assign real names. Names replace generic labels (SPEAKER_00, SPEAKER_01) across all output files.

```bash
# Interactive rename
vidistill rename-speakers ./vidistill-output/my-meeting/

# List current speaker state
vidistill rename-speakers ./vidistill-output/my-meeting/ --list

# Quick rename
vidistill rename-speakers ./vidistill-output/my-meeting/ --rename "Steven Kang" "Steven K."

# Merge duplicate speakers
vidistill rename-speakers ./vidistill-output/my-meeting/ --merge "K Iphone" "Kristian"
```

## Install

```
npm install -g vidistill
```

Requires Node.js 22+ and [ffmpeg](https://ffmpeg.org/). Non-YouTube URLs also require [yt-dlp](https://github.com/yt-dlp/yt-dlp).

## API Key

vidistill needs a Gemini API key. It checks these sources in order:

1. `GEMINI_API_KEY` environment variable
2. `~/.vidistill/config.json`
3. Interactive prompt (with option to save)

Get a key at [ai.google.dev](https://ai.google.dev/).

## How It Works

Supported formats: MP4, MOV, WebM, MKV, AVI, MPEG, FLV, WMV, 3GPP (video) and MP3, AAC, WAV, FLAC, OGG, M4A (audio).

1. **Pass 0** — scene analysis classifies the video and determines processing strategy
2. **Pass 1a/1b** — transcription + speaker diarization, each running 3x with consensus alignment
3. **Pass 2** — visual content extraction (code, slides, diagrams, screen states)
4. **Pass 3** — specialist passes: chat/links (3c), implicit signals (3d), people (3b), code reconstruction (3a, 3x consensus + validation)
5. **Synthesis** — cross-references all passes into unified analysis
6. **Output** — structured markdown and source files

Long videos are segmented automatically — local files and downloaded URLs over 25 minutes are split into 20-minute clips and processed in parallel, with timestamps mapped back to the original timeline. Failed passes are skipped gracefully. In interactive mode, a cost estimate is shown before processing and a quality summary (coverage, consensus rate, tokens) is displayed after.

## License

MIT
