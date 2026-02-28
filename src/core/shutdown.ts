import { log } from '@clack/prompts';
import type { GeminiClient } from '../gemini/client.js';

export interface ShutdownParams {
  client: GeminiClient;
  uploadedFileNames: string[];
  outputDir: string;
  videoTitle: string;
  source: string;
  duration: number;
  model: string;
}

export interface ShutdownHandler {
  isShuttingDown(): boolean;
  register(): void;
  deregister(): void;
}

export function createShutdownHandler(params: ShutdownParams): ShutdownHandler {
  const { client, uploadedFileNames } = params;

  let shuttingDown = false;
  let handler: (() => void) | null = null;

  const sigintHandler = (): void => {
    if (shuttingDown) {
      // Second SIGINT: force exit immediately
      process.exit(1);
      return;
    }

    shuttingDown = true;
    log.warn('Interrupted. Saving partial results...');

    // Register force-exit handler for second SIGINT
    const forceExitHandler = (): void => {
      process.exit(1);
    };
    process.once('SIGINT', forceExitHandler);

    // Best-effort cleanup of uploaded Gemini files
    const cleanupAndExit = async (): Promise<void> => {
      for (const fileName of uploadedFileNames) {
        try {
          await client.deleteFile(fileName);
        } catch {
          // best-effort — swallow errors
        }
      }

      try {
        process.exit(130);
      } catch {
        // In test environments process.exit may throw — ignore
      }
    };

    void cleanupAndExit();
  };

  return {
    isShuttingDown(): boolean {
      return shuttingDown;
    },

    register(): void {
      handler = sigintHandler;
      process.on('SIGINT', handler);
    },

    deregister(): void {
      if (handler !== null) {
        process.removeListener('SIGINT', handler);
        handler = null;
      }
    },
  };
}
