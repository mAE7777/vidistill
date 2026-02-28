# vidistill

Video intelligence distiller — turn any video into structured notes, transcripts, and insights using Gemini.

Feed it a YouTube URL or local video file. It analyzes the content through multiple AI passes (scene analysis, transcript, visuals, code extraction, people, chat, implicit signals) and synthesizes everything into organized markdown output.

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

- `input` — YouTube URL or local file path (prompted interactively if omitted)

**Options:**

- `-c, --context` — context about the video (e.g. "CS lecture", "product demo")
- `-o, --output` — output directory (default: `./vidistill-output/`)

**Examples:**

```bash
# Interactive mode — prompts for everything
vidistill

# YouTube video
vidistill "https://youtube.com/watch?v=dQw4w9WgXcQ"

# Local file with context
vidistill ./lecture.mp4 --context "distributed systems lecture"

# Custom output directory
vidistill ./demo.mp4 -o ./notes/
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
├── code.md            # extracted code blocks and reconstructions
├── people.md          # speakers and participants
├── chat.md            # chat messages and links
├── action-items.md    # tasks and follow-ups
├── insights.md        # implicit signals and analysis
├── links.md           # all URLs mentioned
├── metadata.json      # processing metadata
└── raw/               # raw pass outputs
```

Which files are generated depends on the video content — a coding tutorial gets `code.md`, a meeting gets `people.md` and `action-items.md`, etc.

## How It Works

1. **Input** — downloads YouTube video via yt-dlp or reads local file, compresses if over 2GB
2. **Pass 0** — scene analysis to classify video type and determine processing strategy
3. **Pass 1** — transcript extraction with speaker identification
4. **Pass 2** — visual content extraction (screen states, diagrams, slides)
5. **Pass 3** — specialist passes based on video type:
   - 3a: code reconstruction (coding videos)
   - 3b: people and social dynamics (meetings)
   - 3c: chat and links (live streams)
   - 3d: implicit signals (all types)
6. **Synthesis** — cross-references all passes into unified analysis
7. **Output** — generates structured markdown files

Long videos are segmented automatically. Passes that fail are skipped gracefully.

## License

MIT
