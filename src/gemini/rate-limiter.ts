export class RateLimiter {
  private currentDelay: number;
  private readonly minDelay: number;
  private readonly maxDelay: number;
  private isFirstCall = true;

  constructor(options?: { minDelay?: number; maxDelay?: number; initialDelay?: number }) {
    this.minDelay = options?.minDelay ?? 2000;
    this.maxDelay = options?.maxDelay ?? 120000;
    this.currentDelay = options?.initialDelay ?? this.minDelay;
  }

  getCurrentDelay() {
    return this.currentDelay;
  }

  async execute<T>(
    fn: () => Promise<T>,
    options?: { onCallStart?: () => void; onWait?: (delayMs: number) => void },
  ): Promise<T> {
    const maxRetries = 5;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (!this.isFirstCall) {
        options?.onWait?.(this.currentDelay);
        await new Promise(r => setTimeout(r, this.currentDelay));
      }
      this.isFirstCall = false;

      options?.onCallStart?.();

      try {
        const result = await fn();
        this.currentDelay = Math.max(this.minDelay, Math.floor(this.currentDelay * 0.9));
        return result;
      } catch (e: unknown) {
        const err = e as { status?: number; retryAfter?: number; message?: string };
        if (err.status === 429 && attempt < maxRetries) {
          const retryAfterSeconds = err.retryAfter ?? 60;
          this.currentDelay = Math.min(this.maxDelay, retryAfterSeconds * 1000 + 5000);
          continue;
        }
        throw e;
      }
    }

    throw new Error('Rate limiter: max retries exceeded');
  }

  reset() {
    this.currentDelay = this.minDelay;
    this.isFirstCall = true;
  }
}
