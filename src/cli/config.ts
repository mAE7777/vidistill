import { promises as fs } from 'fs';
import { join } from 'path';
import os from 'os';
import { log } from '@clack/prompts';
import pc from 'picocolors';
import { GeminiClient } from '../gemini/client.js';
import { promptApiKey, promptSaveKey } from './prompts.js';

export interface VidistillConfig {
  apiKey?: string;
  defaultOutputDir?: string;
}

const CONFIG_DIR = join(os.homedir(), '.vidistill');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const MAX_ATTEMPTS = 3;

export async function loadConfig(): Promise<VidistillConfig | null> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    if (obj['apiKey'] !== undefined && typeof obj['apiKey'] !== 'string') {
      return null;
    }
    return obj as VidistillConfig;
  } catch {
    return null;
  }
}

export async function saveConfig(config: VidistillConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

export async function resolveApiKey(): Promise<string> {
  // (1) Check environment variable
  const envKey = process.env['GEMINI_API_KEY'];
  if (envKey && envKey.trim().length > 0) {
    log.info(pc.dim('(using GEMINI_API_KEY from environment)'));
    return envKey.trim();
  }

  // (2) Check ~/.vidistill/config.json
  const config = await loadConfig();
  if (config?.apiKey && config.apiKey.trim().length > 0) {
    log.info(pc.dim('(using API key from ~/.vidistill/config.json)'));
    return config.apiKey.trim();
  }

  // (3) Prompt user — up to MAX_ATTEMPTS times
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const key = await promptApiKey();

    const client = new GeminiClient(key);
    const valid = await client.validateKey();

    if (!valid) {
      log.error(pc.red('Invalid API key'));
      if (attempt === MAX_ATTEMPTS) {
        log.error(pc.red('Maximum attempts reached. Exiting.'));
        process.exit(1);
      }
      continue;
    }

    // Valid key obtained via prompt — offer to save
    const save = await promptSaveKey();
    if (save) {
      const existing = (await loadConfig()) ?? {};
      await saveConfig({ ...existing, apiKey: key });
    }

    return key;
  }

  // Unreachable — process.exit called above, but satisfies TS
  process.exit(1);
}
