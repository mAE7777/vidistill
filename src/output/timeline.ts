import type { PipelineResult, SpeakerMapping } from '../types/index.js';
import { parseTimestamp, formatTime, applySpeakerMapping } from '../lib/utils.js';

export interface GenerateTimelineParams {
  pipelineResult: PipelineResult;
  duration: number;
  speakerMapping?: SpeakerMapping;
}

interface TimelineMarker {
  seconds: number;
  label: string;
  lane: 'speech' | 'code' | 'visual' | 'topic';
  detail: string;
}

function toPercent(seconds: number, duration: number): string {
  if (duration <= 0) return '0';
  const pct = Math.min(100, Math.max(0, (seconds / duration) * 100));
  return pct.toFixed(3);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function collectMarkers(pipelineResult: PipelineResult, duration: number, speakerMapping?: SpeakerMapping): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  const SPEECH_WINDOW_SECONDS = 30;

  for (const segment of pipelineResult.segments) {
    // Speech markers — group within 30-second windows to avoid overwhelming the timeline
    if (segment.pass1 != null) {
      let windowStart = -1;
      let windowLabel = '';
      let windowDetail = '';

      for (const entry of segment.pass1.transcript_entries) {
        const seconds = parseTimestamp(entry.timestamp);
        if (seconds > duration && duration > 0) continue;

        if (windowStart < 0 || seconds - windowStart >= SPEECH_WINDOW_SECONDS) {
          if (windowStart >= 0) {
            markers.push({ seconds: windowStart, label: windowLabel, lane: 'speech', detail: windowDetail });
          }
          windowStart = seconds;
          windowLabel = applySpeakerMapping(entry.speaker || 'Speech', speakerMapping);
          windowDetail = entry.text.slice(0, 80) + (entry.text.length > 80 ? '…' : '');
        }
      }
      if (windowStart >= 0) {
        markers.push({ seconds: windowStart, label: windowLabel, lane: 'speech', detail: windowDetail });
      }
    }

    // Code markers
    if (segment.pass2 != null) {
      for (const block of segment.pass2.code_blocks) {
        const seconds = parseTimestamp(block.timestamp);
        if (seconds > duration && duration > 0) continue;
        markers.push({
          seconds,
          lane: 'code',
          label: block.filename,
          detail: block.language + (block.change_type ? ` · ${block.change_type}` : ''),
        });
      }

      // Visual markers
      for (const note of segment.pass2.visual_notes) {
        const seconds = parseTimestamp(note.timestamp);
        if (seconds > duration && duration > 0) continue;
        markers.push({
          seconds,
          lane: 'visual',
          label: note.visual_type,
          detail: note.description.slice(0, 80) + (note.description.length > 80 ? '…' : ''),
        });
      }
    }
  }

  // Topic markers from synthesis
  const topics = pipelineResult.synthesisResult?.topics ?? [];
  for (const topic of topics) {
    for (const ts of topic.timestamps) {
      const seconds = parseTimestamp(ts);
      if (seconds > duration && duration > 0) continue;
      markers.push({
        seconds,
        lane: 'topic',
        label: topic.title,
        detail: topic.summary?.slice(0, 80) ?? '',
      });
    }
  }

  return markers;
}

function renderMarker(m: TimelineMarker, duration: number): string {
  const left = toPercent(m.seconds, duration);
  const time = formatTime(m.seconds);
  // Build raw tooltip text then escape once for HTML attribute context
  const tooltipRaw = `${time} — ${m.label}${m.detail ? ': ' + m.detail : ''}`;
  const tooltipAttr = escapeHtml(tooltipRaw);
  return `<div class="marker marker-${m.lane}" style="left:${left}%" title="${tooltipAttr}" aria-label="${tooltipAttr}"></div>`;
}

function renderLane(
  laneId: 'speech' | 'code' | 'visual' | 'topic',
  laneLabel: string,
  markers: TimelineMarker[],
  duration: number,
): string {
  const laneMarkers = markers.filter((m) => m.lane === laneId);
  const renderedMarkers = laneMarkers.map((m) => renderMarker(m, duration)).join('\n        ');
  return `
    <div class="lane">
      <div class="lane-label">${laneLabel}</div>
      <div class="lane-track" role="region" aria-label="${laneLabel} lane">
        ${renderedMarkers}
      </div>
    </div>`;
}

function buildTimeAxis(duration: number): string {
  if (duration <= 0) return '';
  // Pick a reasonable tick interval
  const intervals = [30, 60, 120, 300, 600, 900, 1800, 3600];
  const targetTicks = 10;
  const ideal = duration / targetTicks;
  const interval = intervals.find((i) => i >= ideal) ?? intervals[intervals.length - 1] ?? 3600;

  const ticks: string[] = [];
  for (let t = 0; t <= duration; t += interval) {
    const left = toPercent(t, duration);
    const label = formatTime(t);
    ticks.push(`<div class="tick" style="left:${left}%"><span>${label}</span></div>`);
  }
  return ticks.join('\n        ');
}

export function generateTimeline(params: GenerateTimelineParams): string {
  const { pipelineResult, duration, speakerMapping } = params;
  const markers = collectMarkers(pipelineResult, duration, speakerMapping);
  const effectiveDuration = duration > 0 ? duration : 1;

  const speechLane = renderLane('speech', 'Speech', markers, effectiveDuration);
  const codeLane = renderLane('code', 'Code', markers, effectiveDuration);
  const visualLane = renderLane('visual', 'Slides / Visuals', markers, effectiveDuration);
  const topicLane = renderLane('topic', 'Key Moments', markers, effectiveDuration);
  const timeAxis = buildTimeAxis(effectiveDuration);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Video Timeline</title>
  <style>
    /* ------------------------------------------------------------------ */
    /* Reset + base                                                        */
    /* ------------------------------------------------------------------ */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #f9fafb;
      --surface: #ffffff;
      --border: #e5e7eb;
      --text: #111827;
      --text-muted: #6b7280;
      --shadow: 0 1px 3px rgba(0,0,0,.1);

      --speech-color: #3b82f6;
      --code-color: #22c55e;
      --visual-color: #a855f7;
      --topic-color: #eab308;

      --lane-h: 36px;
      --label-w: 120px;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f172a;
        --surface: #1e293b;
        --border: #334155;
        --text: #f1f5f9;
        --text-muted: #94a3b8;
        --shadow: 0 1px 3px rgba(0,0,0,.4);
      }
    }

    html, body {
      height: 100%;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
    }

    /* ------------------------------------------------------------------ */
    /* Layout                                                             */
    /* ------------------------------------------------------------------ */
    .page {
      max-width: 100%;
      padding: 1.5rem 1rem;
    }

    h1 {
      font-size: 1.25rem;
      font-weight: 700;
      margin-bottom: 1rem;
    }

    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: .5rem 1rem;
      margin-bottom: 1.25rem;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: .4rem;
      font-size: .8125rem;
      color: var(--text-muted);
    }

    .legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .legend-dot.speech  { background: var(--speech-color); }
    .legend-dot.code    { background: var(--code-color); }
    .legend-dot.visual  { background: var(--visual-color); }
    .legend-dot.topic   { background: var(--topic-color); }

    /* ------------------------------------------------------------------ */
    /* Scroll container                                                   */
    /* ------------------------------------------------------------------ */
    .scroll-wrapper {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      border: 1px solid var(--border);
      border-radius: .5rem;
      background: var(--surface);
      box-shadow: var(--shadow);
    }

    .timeline {
      min-width: 640px;
      padding: 1rem;
    }

    /* ------------------------------------------------------------------ */
    /* Lanes                                                              */
    /* ------------------------------------------------------------------ */
    .lane {
      display: flex;
      align-items: center;
      margin-bottom: .5rem;
    }

    .lane-label {
      width: var(--label-w);
      flex-shrink: 0;
      font-size: .75rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: .04em;
      padding-right: .75rem;
    }

    .lane-track {
      flex: 1;
      height: var(--lane-h);
      position: relative;
      background: var(--bg);
      border-radius: .25rem;
      border: 1px solid var(--border);
    }

    /* ------------------------------------------------------------------ */
    /* Markers                                                            */
    /* ------------------------------------------------------------------ */
    .marker {
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 10px;
      height: 10px;
      border-radius: 50%;
      cursor: pointer;
      transition: transform .15s ease, box-shadow .15s ease;
      outline: none;
    }

    .marker:hover, .marker:focus {
      transform: translate(-50%, -50%) scale(1.6);
      box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px currentColor;
      z-index: 10;
    }

    .marker-speech { background: var(--speech-color); color: var(--speech-color); }
    .marker-code   { background: var(--code-color);   color: var(--code-color); }
    .marker-visual { background: var(--visual-color); color: var(--visual-color); }
    .marker-topic  { background: var(--topic-color);  color: var(--topic-color); }

    /* ------------------------------------------------------------------ */
    /* Time axis                                                          */
    /* ------------------------------------------------------------------ */
    .time-axis {
      display: flex;
      align-items: center;
      margin-bottom: .25rem;
    }

    .axis-spacer {
      width: var(--label-w);
      flex-shrink: 0;
    }

    .axis-track {
      flex: 1;
      height: 20px;
      position: relative;
    }

    .tick {
      position: absolute;
      top: 0;
      transform: translateX(-50%);
    }

    .tick span {
      font-size: .6875rem;
      color: var(--text-muted);
      white-space: nowrap;
    }

    /* ------------------------------------------------------------------ */
    /* Tooltip (vanilla JS)                                               */
    /* ------------------------------------------------------------------ */
    #tooltip {
      position: fixed;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: .375rem;
      padding: .375rem .625rem;
      font-size: .8125rem;
      color: var(--text);
      pointer-events: none;
      z-index: 999;
      box-shadow: 0 4px 12px rgba(0,0,0,.15);
      max-width: 280px;
      word-break: break-word;
      display: none;
    }

    /* ------------------------------------------------------------------ */
    /* Responsive                                                         */
    /* ------------------------------------------------------------------ */
    @media (max-width: 480px) {
      :root { --label-w: 72px; --lane-h: 32px; }
      .legend { gap: .35rem .75rem; }
      h1 { font-size: 1.1rem; }
    }
  </style>
</head>
<body>
  <div class="page">
    <h1>Video Timeline</h1>

    <div class="legend" aria-label="Lane colour legend">
      <span class="legend-item"><span class="legend-dot speech"></span>Speech</span>
      <span class="legend-item"><span class="legend-dot code"></span>Code</span>
      <span class="legend-item"><span class="legend-dot visual"></span>Slides / Visuals</span>
      <span class="legend-item"><span class="legend-dot topic"></span>Key Moments</span>
    </div>

    <div class="scroll-wrapper">
      <div class="timeline">
        <div class="time-axis">
          <div class="axis-spacer"></div>
          <div class="axis-track">
            ${timeAxis}
          </div>
        </div>
        ${speechLane}
        ${codeLane}
        ${visualLane}
        ${topicLane}
      </div>
    </div>
  </div>

  <div id="tooltip" role="tooltip"></div>

  <script>
    (function () {
      var tooltip = document.getElementById('tooltip');
      var markers = document.querySelectorAll('.marker');

      function showTooltip(el, x, y) {
        var text = el.getAttribute('title') || el.getAttribute('aria-label') || '';
        if (!text) return;
        tooltip.textContent = text;
        tooltip.style.display = 'block';
        positionTooltip(x, y);
      }

      function positionTooltip(x, y) {
        var tw = tooltip.offsetWidth;
        var th = tooltip.offsetHeight;
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var left = x + 12;
        var top = y - th / 2;
        if (left + tw > vw - 8) left = x - tw - 12;
        if (top < 8) top = 8;
        if (top + th > vh - 8) top = vh - th - 8;
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
      }

      function hideTooltip() {
        tooltip.style.display = 'none';
      }

      markers.forEach(function (m) {
        m.addEventListener('mouseenter', function (e) {
          showTooltip(m, e.clientX, e.clientY);
        });
        m.addEventListener('mousemove', function (e) {
          positionTooltip(e.clientX, e.clientY);
        });
        m.addEventListener('mouseleave', hideTooltip);
        m.addEventListener('focus', function () {
          var rect = m.getBoundingClientRect();
          showTooltip(m, rect.right, rect.top + rect.height / 2);
        });
        m.addEventListener('blur', hideTooltip);
      });
    })();
  </script>
</body>
</html>`;
}
