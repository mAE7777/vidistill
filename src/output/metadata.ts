import type {
  PipelineResult,
  VideoType,
} from '../types/index.js';

export interface MetadataOutput {
  videoTitle: string;
  source: string;
  duration: number;
  type: VideoType | 'unknown';
  model: string;
  passesRun: string[];
  segmentCount: number;
  processingTimeMs: number;
  filesGenerated: string[];
  errors: string[];
  generatedAt: string;
}

export interface WriteMetadataParams {
  title: string;
  source: string;
  duration: number;
  model: string;
  processingTimeMs: number;
  filesGenerated: string[];
  pipelineResult: PipelineResult;
}

export function writeMetadata(params: WriteMetadataParams): string {
  const { title, source, duration, model, processingTimeMs, filesGenerated, pipelineResult } = params;
  const { passesRun, segments, errors, videoProfile } = pipelineResult;

  const output: MetadataOutput = {
    videoTitle: title,
    source,
    duration,
    type: videoProfile?.type ?? 'unknown',
    model,
    passesRun,
    segmentCount: segments.length,
    processingTimeMs,
    filesGenerated,
    errors,
    generatedAt: new Date().toISOString(),
  };

  return JSON.stringify(output, null, 2);
}

export function writeRawOutput(pipelineResult: PipelineResult): Map<string, string> {
  const files = new Map<string, string>();
  const { segments, videoProfile, peopleExtraction, synthesisResult } = pipelineResult;

  if (videoProfile != null) {
    files.set('pass0-scene.json', JSON.stringify(videoProfile, null, 2));
  }

  for (const seg of segments) {
    const n = seg.index;

    if (seg.pass1 != null) {
      files.set(`pass1-seg${n}.json`, JSON.stringify(seg.pass1, null, 2));
    }

    if (seg.pass2 != null) {
      files.set(`pass2-seg${n}.json`, JSON.stringify(seg.pass2, null, 2));
    }

    if (seg.pass3a != null) {
      files.set(`pass3a-seg${n}.json`, JSON.stringify(seg.pass3a, null, 2));
    }

    if (seg.pass3c != null) {
      files.set(`pass3c-seg${n}.json`, JSON.stringify(seg.pass3c, null, 2));
    }

    if (seg.pass3d != null) {
      files.set(`pass3d-seg${n}.json`, JSON.stringify(seg.pass3d, null, 2));
    }
  }

  if (peopleExtraction != null) {
    files.set('pass3b-people.json', JSON.stringify(peopleExtraction, null, 2));
  }

  if (synthesisResult != null) {
    files.set('synthesis.json', JSON.stringify(synthesisResult, null, 2));
  }

  return files;
}
