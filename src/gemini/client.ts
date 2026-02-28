import {
  GoogleGenAI,
  FileState,
  type Content,
  type GenerateContentConfig,
} from '@google/genai';

export interface UploadedFile {
  uri: string;
  mimeType: string;
  name: string;
  duration: number | undefined;
}

export class GeminiClient {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async validateKey(): Promise<boolean> {
    try {
      await this.ai.models.get({ model: 'gemini-2.5-flash' });
      return true;
    } catch {
      return false;
    }
  }

  async uploadFile(filePath: string): Promise<UploadedFile> {
    const uploaded = await this.ai.files.upload({ file: filePath });

    if (!uploaded.name) {
      throw new Error('Upload returned file without a name');
    }

    const maxWaitMs = 300_000;
    const pollIntervalMs = 2_000;
    const deadline = Date.now() + maxWaitMs;

    let file = uploaded;

    while (file.state !== FileState.ACTIVE) {
      if (file.state === FileState.FAILED) {
        throw new Error(`File upload failed: ${file.name}`);
      }

      if (Date.now() >= deadline) {
        throw new Error(`File did not become ACTIVE within ${maxWaitMs / 1000} seconds`);
      }

      await new Promise(r => setTimeout(r, pollIntervalMs));
      file = await this.ai.files.get({ name: file.name as string });
    }

    if (!file.uri) {
      throw new Error('File is ACTIVE but missing uri');
    }
    if (!file.mimeType) {
      throw new Error('File is ACTIVE but missing mimeType');
    }

    const rawDuration = (file.videoMetadata as Record<string, unknown> | undefined)
      ?.videoDuration;
    let duration: number | undefined;
    if (typeof rawDuration === 'string') {
      const stripped = rawDuration.replace(/s$/i, '');
      const parsed = parseFloat(stripped);
      duration = isNaN(parsed) ? undefined : parsed;
    }

    return {
      uri: file.uri,
      mimeType: file.mimeType,
      name: file.name as string,
      duration,
    };
  }

  async deleteFile(fileName: string): Promise<void> {
    try {
      await this.ai.files.delete({ name: fileName });
    } catch (err) {
      console.error(`Failed to delete file ${fileName}:`, err);
    }
  }

  async generate(params: {
    model: string;
    contents: Content[];
    config: GenerateContentConfig;
  }): Promise<unknown> {
    const response = await this.ai.models.generateContent(params);

    if (!response.text) {
      throw new Error('Gemini returned an empty response');
    }

    return JSON.parse(response.text) as unknown;
  }
}
