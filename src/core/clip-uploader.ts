import type { GeminiClient } from '../gemini/client.js';
import type { UploadedClip } from './clip-pipeline.js';
import type { ClipInfo } from './splitter.js';

/**
 * Upload clip files to Gemini sequentially.
 * Tracks each upload in `uploadedFileNames` immediately so partial failures
 * don't leak Gemini-side files.
 */
export async function uploadClips(
  client: GeminiClient,
  clips: ClipInfo[],
  uploadedFileNames: string[],
): Promise<UploadedClip[]> {
  const uploaded: UploadedClip[] = [];

  for (const clip of clips) {
    const result = await client.uploadFile(clip.filePath);
    // Track immediately — if a later upload fails, shutdown/cleanup can still delete this file
    uploadedFileNames.push(result.name);
    uploaded.push({
      index: clip.index,
      fileUri: result.uri,
      mimeType: result.mimeType,
      uploadedFileName: result.name,
      globalStartTime: clip.startTime,
      globalEndTime: clip.endTime,
      clipDuration: clip.endTime - clip.startTime,
      overlapDuration: clip.overlapDuration,
    });
  }

  return uploaded;
}

/**
 * Best-effort deletion of uploaded Gemini files.
 */
export async function deleteUploadedClips(
  client: GeminiClient,
  fileNames: string[],
): Promise<void> {
  for (const name of fileNames) {
    try {
      await client.deleteFile(name);
    } catch {
      // best-effort
    }
  }
}
