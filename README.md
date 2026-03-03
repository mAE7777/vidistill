# vidistill

Video intelligence distiller — turn any video or audio file into structured notes, transcripts, and insights using Gemini.

Feed it a YouTube URL, local video, or audio file. It analyzes the content through multiple AI passes (scene analysis, transcript, visuals, code extraction, people, chat, implicit signals) and synthesizes everything into organized markdown output.

## Install

```
npm install -g vidistill
```

Requires Node.js 22+ and [ffmpeg](https://ffmpeg.org/).

## Usage

```
vidistill [input] [options]
```

**Arguments:**

- `input` — YouTube URL, local video, or audio file path (prompted interactively if omitted)

**Options:**

- `-c, --context` — context about the video (e.g. "CS lecture", "product demo")
- `-o, --output` — output directory (default: `./vidistill-output/`)
- `-l, --lang <code>` — output language (e.g. `zh`, `ja`, `ko`, `es`, `fr`, `de`, `pt`, `ru`, `ar`, `hi`)

**Examples:**

```bash
# Interactive mode — prompts for everything
vidistill

# YouTube video
vidistill "https://youtube.com/watch?v=dQw4w9WgXcQ"

# Local file with context
vidistill ./lecture.mp4 --context "distributed systems lecture"

# Audio file
vidistill ./podcast.mp3

# Custom output directory
vidistill ./demo.mp4 -o ./notes/

# Output in another language
vidistill ./lecture.mp4 --lang zh
```

## API Key

vidistill needs a Gemini API key. It checks these sources in order:

1. `GEMINI_API_KEY` environment variable
2. `~/.vidistill/config.json`
3. Interactive prompt (with option to save for next time)

Get a key at [ai.google.dev](https://ai.google.dev/).

## Output

vidistill creates a folder per video with structured files:

```
vidistill-output/my-video/
├── guide.md           # overview and navigation
├── transcript.md      # full timestamped transcript
├── combined.md        # transcript + visual notes merged
├── notes.md           # meeting/lecture notes
├── code/              # extracted and reconstructed source files
│   ├── *.ext          # individual source files
│   └── code-timeline.md  # code evolution timeline
├── people.md          # speakers and participants
├── chat.md            # chat messages and links
├── action-items.md    # tasks and follow-ups
├── insights.md        # implicit signals and analysis
├── links.md           # all URLs mentioned
├── prereqs.md         # prerequisite knowledge (when detected)
├── timeline.html      # interactive visual timeline
├── metadata.json      # processing metadata
└── raw/               # raw pass outputs
```

Which files are generated depends on the video content — a coding tutorial gets `code/`, a meeting gets `people.md` and `action-items.md`, etc.

### Speaker Naming

When multiple speakers are detected, use `rename-speakers` to assign real names. Names replace generic labels (SPEAKER_00, SPEAKER_01) in all output files.

To rename speakers:

```bash
# Interactive rename — prompts for each speaker
vidistill rename-speakers ./vidistill-output/my-meeting/

# List current speaker state
vidistill rename-speakers ./vidistill-output/my-meeting/ --list

# Quick rename a single speaker
vidistill rename-speakers ./vidistill-output/my-meeting/ --rename "Steven Kang" "Steven K."

# Merge two speakers (e.g. same person on different devices)
vidistill rename-speakers ./vidistill-output/my-meeting/ --merge "K Iphone" "Kristian"
```

## How It Works

Supported video formats: MP4, MOV, WebM, MKV, AVI, MPEG, FLV, WMV, 3GPP. Supported audio formats: MP3, AAC, WAV, FLAC, OGG, M4A.

1. **Input** — accepts YouTube URL directly or reads local file (video or audio), compresses if over 2GB
2. **Pass 0** — scene analysis to classify video type and determine processing strategy
3. **Pass 1** — transcript extraction with speaker identification
4. **Pass 2** — visual content extraction (screen states, diagrams, slides)
5. **Pass 3** — specialist passes based on video type:
   - 3c: chat and links (live streams) — per segment, runs 3x with consensus voting
   - 3d: implicit signals (all types) — per segment
   - 3b: people and social dynamics (meetings) — whole video
   - 3a: code reconstruction (coding videos) — whole video, runs 3x with consensus voting and validation
6. **Synthesis** — cross-references all passes into unified analysis
7. **Output** — generates structured markdown files

Audio files skip visual passes and go straight to transcript, people, implicit signals, and synthesis.

Long videos are segmented automatically. Passes that fail are skipped gracefully.

## License

MIT
