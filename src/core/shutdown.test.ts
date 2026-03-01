import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createShutdownHandler } from './shutdown.js';
import type { ShutdownParams } from './shutdown.js';

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
  log: {
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

function makeParams(overrides: Partial<ShutdownParams> = {}): ShutdownParams {
  return {
    client: {
      deleteFile: vi.fn().mockResolvedValue(undefined),
    } as unknown as ShutdownParams['client'],
    uploadedFileNames: [],
    outputDir: '/tmp/test-output',
    videoTitle: 'Test Video',
    source: '/tmp/test.mp4',
    duration: 120,
    model: 'gemini-2.5-flash',
    ...overrides,
  };
}

describe('createShutdownHandler', () => {
  let originalExit: typeof process.exit;

  beforeEach(() => {
    originalExit = process.exit;
  });

  afterEach(() => {
    process.exit = originalExit;
    vi.restoreAllMocks();
  });

  it('starts not shutting down', () => {
    const handler = createShutdownHandler(makeParams());
    expect(handler.isShuttingDown()).toBe(false);
  });

  it('register() calls process.on with SIGINT', () => {
    const onSpy = vi.spyOn(process, 'on');
    const handler = createShutdownHandler(makeParams());
    handler.register();
    expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    handler.deregister();
  });

  it('deregister() calls process.removeListener with the SAME function reference registered', () => {
    // Track what was registered and deregistered
    const registeredFns: ((...args: unknown[]) => void)[] = [];
    const deregisteredFns: ((...args: unknown[]) => void)[] = [];

    const onSpy = vi.spyOn(process, 'on').mockImplementation(
      (event: string | symbol, fn: (...args: unknown[]) => void) => {
        if (event === 'SIGINT') registeredFns.push(fn);
        return process;
      },
    );
    const removeListenerSpy = vi.spyOn(process, 'removeListener').mockImplementation(
      (event: string | symbol, fn: (...args: unknown[]) => void) => {
        if (event === 'SIGINT') deregisteredFns.push(fn);
        return process;
      },
    );

    const handler = createShutdownHandler(makeParams());
    handler.register();
    handler.deregister();

    // Verify removeListener was called
    expect(removeListenerSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));

    // Verify the SAME function reference was used for both register and deregister
    expect(registeredFns).toHaveLength(1);
    expect(deregisteredFns).toHaveLength(1);
    expect(registeredFns[0]).toBe(deregisteredFns[0]);

    onSpy.mockRestore();
    removeListenerSpy.mockRestore();
  });

  it('deregister() without register() does not throw', () => {
    const handler = createShutdownHandler(makeParams());
    expect(() => handler.deregister()).not.toThrow();
  });

  it('SIGINT sets isShuttingDown to true and logs "Interrupted" when no progress set', async () => {
    const { log } = await import('@clack/prompts');
    const warnSpy = vi.spyOn(log, 'warn');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    vi.spyOn(process, 'once').mockImplementation(() => process);

    const params = makeParams({ uploadedFileNames: [] });
    const handler = createShutdownHandler(params);

    let capturedHandler: (() => void) | undefined;
    vi.spyOn(process, 'on').mockImplementation(
      (event: string | symbol, fn: (...args: unknown[]) => void) => {
        if (event === 'SIGINT') capturedHandler = fn as () => void;
        return process;
      },
    );

    handler.register();
    expect(capturedHandler).toBeDefined();

    capturedHandler!();

    expect(handler.isShuttingDown()).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith('Interrupted');

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(130);
    }, { timeout: 1000 });
  });

  it('setProgress() method exists on ShutdownHandler', () => {
    const handler = createShutdownHandler(makeParams());
    expect(typeof handler.setProgress).toBe('function');
  });

  it('SIGINT shows step count and resume hint after setProgress is called', async () => {
    const { log } = await import('@clack/prompts');
    const warnSpy = vi.spyOn(log, 'warn');
    const infoSpy = vi.spyOn(log, 'info');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    vi.spyOn(process, 'once').mockImplementation(() => process);

    const params = makeParams({ uploadedFileNames: [], source: '/tmp/test.mp4', outputDir: '/tmp/test-output' });
    const handler = createShutdownHandler(params);

    let capturedHandler: (() => void) | undefined;
    vi.spyOn(process, 'on').mockImplementation(
      (event: string | symbol, fn: (...args: unknown[]) => void) => {
        if (event === 'SIGINT') capturedHandler = fn as () => void;
        return process;
      },
    );

    handler.register();
    handler.setProgress(5, 12);
    capturedHandler!();

    expect(warnSpy).toHaveBeenCalledWith('Interrupted — progress saved (5/12 steps)');
    expect(infoSpy).toHaveBeenCalledWith('Resume: vidistill /tmp/test.mp4 -o /tmp/test-output/');

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(130);
    }, { timeout: 1000 });
  });

  it('SIGINT shows only "Interrupted" when setProgress not called (pass0 scenario)', async () => {
    const { log } = await import('@clack/prompts');
    const warnSpy = vi.spyOn(log, 'warn');
    const infoSpy = vi.spyOn(log, 'info');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    vi.spyOn(process, 'once').mockImplementation(() => process);

    const params = makeParams({ uploadedFileNames: [] });
    const handler = createShutdownHandler(params);

    let capturedHandler: (() => void) | undefined;
    vi.spyOn(process, 'on').mockImplementation(
      (event: string | symbol, fn: (...args: unknown[]) => void) => {
        if (event === 'SIGINT') capturedHandler = fn as () => void;
        return process;
      },
    );

    handler.register();
    // do NOT call setProgress — simulating interruption during pass0
    capturedHandler!();

    expect(warnSpy).toHaveBeenCalledWith('Interrupted');
    expect(infoSpy).not.toHaveBeenCalledWith(expect.stringContaining('Resume:'));

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(130);
    }, { timeout: 1000 });
  });

  it('SIGINT calls deleteFile for each uploaded file (best-effort)', async () => {
    const deleteFileMock = vi.fn().mockResolvedValue(undefined);
    const params = makeParams({
      uploadedFileNames: ['files/abc', 'files/xyz'],
      client: { deleteFile: deleteFileMock } as unknown as ShutdownParams['client'],
    });

    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    vi.spyOn(process, 'once').mockImplementation(() => process);

    let capturedHandler: (() => void) | undefined;
    vi.spyOn(process, 'on').mockImplementation(
      (event: string | symbol, fn: (...args: unknown[]) => void) => {
        if (event === 'SIGINT') capturedHandler = fn as () => void;
        return process;
      },
    );

    const handler = createShutdownHandler(params);
    handler.register();
    capturedHandler!();

    await vi.waitFor(() => {
      expect(deleteFileMock).toHaveBeenCalledWith('files/abc');
      expect(deleteFileMock).toHaveBeenCalledWith('files/xyz');
    }, { timeout: 1000 });
  });

  it('deleteFile errors are swallowed (best-effort cleanup)', async () => {
    const deleteFileMock = vi.fn().mockRejectedValue(new Error('network error'));
    const params = makeParams({
      uploadedFileNames: ['files/abc'],
      client: { deleteFile: deleteFileMock } as unknown as ShutdownParams['client'],
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    vi.spyOn(process, 'once').mockImplementation(() => process);

    let capturedHandler: (() => void) | undefined;
    vi.spyOn(process, 'on').mockImplementation(
      (event: string | symbol, fn: (...args: unknown[]) => void) => {
        if (event === 'SIGINT') capturedHandler = fn as () => void;
        return process;
      },
    );

    const handler = createShutdownHandler(params);
    handler.register();
    capturedHandler!();

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(130);
    }, { timeout: 1000 });
  });

  it('second SIGINT registers a force-exit handler via process.once', () => {
    const onceSpy = vi.spyOn(process, 'once').mockImplementation(() => process);
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);

    let capturedHandler: (() => void) | undefined;
    vi.spyOn(process, 'on').mockImplementation(
      (event: string | symbol, fn: (...args: unknown[]) => void) => {
        if (event === 'SIGINT') capturedHandler = fn as () => void;
        return process;
      },
    );

    const handler = createShutdownHandler(makeParams({ uploadedFileNames: [] }));
    handler.register();
    capturedHandler!();

    expect(onceSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
  });

  it('exits with code 130 on SIGINT', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    vi.spyOn(process, 'once').mockImplementation(() => process);

    let capturedHandler: (() => void) | undefined;
    vi.spyOn(process, 'on').mockImplementation(
      (event: string | symbol, fn: (...args: unknown[]) => void) => {
        if (event === 'SIGINT') capturedHandler = fn as () => void;
        return process;
      },
    );

    const handler = createShutdownHandler(makeParams({ uploadedFileNames: [] }));
    handler.register();
    capturedHandler!();

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(130);
    }, { timeout: 1000 });
  });
});
