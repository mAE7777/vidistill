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
  setProgress(currentStep: number, totalSteps: number): void;
}

export function createShutdownHandler(params: ShutdownParams): ShutdownHandler {
  const { client, uploadedFileNames } = params;

  let shuttingDown = false;
  let handler: (() => void) | null = null;
  let forceHandler: (() => void) | null = null;

  let progressCurrentStep = 0;
  let progressTotalSteps = 0;
  let hasProgress = false;

  const sigintHandler = (): void => {
    if (shuttingDown) {
      // Second SIGINT: force exit immediately
      process.exit(1);
      return;
    }

    shuttingDown = true;

    if (hasProgress) {
      log.warn(`Interrupted — progress saved (${progressCurrentStep}/${progressTotalSteps} steps)`);
      log.info(`Resume: vidistill ${params.source} -o ${params.outputDir}/`);
    } else {
      log.warn('Interrupted');
    }

    // Register force-exit handler for second SIGINT
    const forceExitHandler = (): void => {
      process.exit(1);
    };
    forceHandler = forceExitHandler;
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
      if (forceHandler !== null) {
        process.removeListener('SIGINT', forceHandler);
        forceHandler = null;
      }
    },

    setProgress(currentStep: number, totalSteps: number): void {
      progressCurrentStep = currentStep;
      progressTotalSteps = totalSteps;
      hasProgress = true;
    },
  };
}
