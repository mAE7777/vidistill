import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

describe('Phase 3 Gate 2: RateLimiter unit tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Test 1: Initial delay is 2000ms
  it('initial delay is 2000ms', () => {
    const rl = new RateLimiter();
    expect(rl.getCurrentDelay()).toBe(2000);
  });

  // Test 2: execute(fn) executes fn and returns result
  it('execute(fn) executes fn and returns result', async () => {
    const rl = new RateLimiter();
    const fn = vi.fn().mockResolvedValue('hello');

    const promise = rl.execute(fn);
    // First call skips delay, so should resolve immediately
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('hello');
    expect(fn).toHaveBeenCalledOnce();
  });

  // Test 3: Sequential execution — 2nd call waits ≥ minDelay
  it('sequential execution: 2nd call waits for delay', async () => {
    const rl = new RateLimiter({ minDelay: 100, maxDelay: 5000, initialDelay: 100 });
    const order: number[] = [];

    // First call: no wait
    const p1 = rl.execute(async () => { order.push(1); return 1; });
    await vi.runAllTimersAsync();
    await p1;

    // Second call: should wait ~100ms
    const startTime = Date.now();
    const p2 = rl.execute(async () => { order.push(2); return 2; });
    await vi.advanceTimersByTimeAsync(100);
    await p2;

    expect(order).toEqual([1, 2]);
    // Verify that time advanced by at least the delay
    expect(Date.now() - startTime).toBeGreaterThanOrEqual(100);
  });

  // Test 4: On success, delay decreases by ×0.9
  it('on success, delay decreases by ×0.9', async () => {
    // Start with a higher delay to see the reduction clearly
    const rl = new RateLimiter({ minDelay: 100, maxDelay: 120000, initialDelay: 3000 });

    // First call (no wait, sets isFirstCall=false)
    const p1 = rl.execute(async () => 'ok');
    await vi.runAllTimersAsync();
    await p1;

    // After success, delay = max(100, floor(3000 * 0.9)) = 2700
    expect(rl.getCurrentDelay()).toBe(2700);
  });

  // Test 5: Delay never goes below minDelay (2000ms)
  it('delay never goes below minDelay', async () => {
    const rl = new RateLimiter({ minDelay: 2000, maxDelay: 120000, initialDelay: 2000 });

    // Execute first call (no wait)
    const p1 = rl.execute(async () => 'ok');
    await vi.runAllTimersAsync();
    await p1;

    // floor(2000 * 0.9) = 1800, but min is 2000 → stays at 2000
    expect(rl.getCurrentDelay()).toBe(2000);

    // Execute again with wait
    const p2 = rl.execute(async () => 'ok');
    await vi.runAllTimersAsync();
    await p2;

    // Still 2000 (floor enforced)
    expect(rl.getCurrentDelay()).toBe(2000);
  });

  // Test 6: On 429 error, delay increases to retryAfter + 5s
  it('on 429 error, delay increases to retryAfter + 5s', async () => {
    const rl = new RateLimiter({ minDelay: 100, maxDelay: 120000, initialDelay: 100 });
    let callCount = 0;

    const fn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        const err: any = new Error('Rate limited');
        err.status = 429;
        err.retryAfter = 30; // 30 seconds
        throw err;
      }
      return 'success';
    });

    // First call: no wait, fn throws 429 → delay becomes 30*1000 + 5000 = 35000
    // Then retries: waits 35000ms, fn succeeds
    const p = rl.execute(fn);
    await vi.runAllTimersAsync();
    const result = await p;

    expect(result).toBe('success');
    // After the 429, delay was set to 35000, then on success it reduces by 0.9
    // max(100, floor(35000 * 0.9)) = 31500
    expect(rl.getCurrentDelay()).toBe(31500);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // Test 7: On 429, failed request is retried (re-enqueued at front)
  it('on 429, failed request is retried automatically', async () => {
    const rl = new RateLimiter({ minDelay: 100, maxDelay: 120000, initialDelay: 100 });
    let callCount = 0;

    const fn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        const err: any = new Error('Rate limited');
        err.status = 429;
        err.retryAfter = 1;
        throw err;
      }
      return 'finally';
    });

    const p = rl.execute(fn);
    await vi.runAllTimersAsync();
    const result = await p;

    expect(result).toBe('finally');
    expect(fn).toHaveBeenCalledTimes(3); // 2 failures + 1 success
  });

  // Test 8: On non-429 error, request rejects and moves on
  it('on non-429 error, request rejects', async () => {
    // Use real timers — first call skips delay, so no timer needed
    vi.useRealTimers();
    const rl = new RateLimiter({ minDelay: 100, maxDelay: 120000, initialDelay: 100 });

    const fn = vi.fn().mockImplementation(async () => {
      throw new Error('Server error');
    });

    await expect(rl.execute(fn)).rejects.toThrow('Server error');
    expect(fn).toHaveBeenCalledOnce(); // No retry for non-429
  });

  // Test 9: getCurrentDelay() reflects current state after operations
  it('getCurrentDelay() reflects pending state accurately', async () => {
    const rl = new RateLimiter({ minDelay: 100, maxDelay: 120000, initialDelay: 500 });
    expect(rl.getCurrentDelay()).toBe(500);

    // After success: 500 * 0.9 = 450
    const p1 = rl.execute(async () => 'ok');
    await vi.runAllTimersAsync();
    await p1;
    expect(rl.getCurrentDelay()).toBe(450);

    // After another success: 450 * 0.9 = 405
    const p2 = rl.execute(async () => 'ok');
    await vi.runAllTimersAsync();
    await p2;
    expect(rl.getCurrentDelay()).toBe(405);
  });

  // Test 10: Delay never exceeds maxDelay (120000ms)
  it('delay never exceeds maxDelay', async () => {
    const rl = new RateLimiter({ minDelay: 100, maxDelay: 120000, initialDelay: 100 });
    let callCount = 0;

    const fn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        const err: any = new Error('Rate limited');
        err.status = 429;
        err.retryAfter = 200; // 200s → would be 205000, exceeds max
        throw err;
      }
      return 'ok';
    });

    const p = rl.execute(fn);
    await vi.runAllTimersAsync();
    await p;

    // After 429 with retryAfter=200: min(120000, 200*1000+5000) = 120000
    // After success: max(100, floor(120000 * 0.9)) = 108000
    expect(rl.getCurrentDelay()).toBeLessThanOrEqual(120000);
  });

  // Test 11: Multiple sequential calls process in FIFO order
  it('multiple sequential calls process in order', async () => {
    const rl = new RateLimiter({ minDelay: 50, maxDelay: 5000, initialDelay: 50 });
    const results: number[] = [];

    const p1 = rl.execute(async () => { results.push(1); return 1; });
    await vi.runAllTimersAsync();
    await p1;

    const p2 = rl.execute(async () => { results.push(2); return 2; });
    await vi.runAllTimersAsync();
    await p2;

    const p3 = rl.execute(async () => { results.push(3); return 3; });
    await vi.runAllTimersAsync();
    await p3;

    expect(results).toEqual([1, 2, 3]);
  });

  // Test 12: 429 retry runs before returning to caller
  it('429 retry completes before returning to caller', async () => {
    const rl = new RateLimiter({ minDelay: 50, maxDelay: 120000, initialDelay: 50 });
    const events: string[] = [];
    let callCount = 0;

    const fn = vi.fn().mockImplementation(async () => {
      callCount++;
      events.push(`call-${callCount}`);
      if (callCount === 1) {
        const err: any = new Error('Rate limited');
        err.status = 429;
        err.retryAfter = 1;
        throw err;
      }
      return 'done';
    });

    const p = rl.execute(fn);
    await vi.runAllTimersAsync();
    await p;

    // First call failed with 429, then retried successfully
    expect(events).toEqual(['call-1', 'call-2']);
  });

  // Test 13: Concurrent calls all resolve eventually
  it('concurrent execute calls all resolve', async () => {
    const rl = new RateLimiter({ minDelay: 50, maxDelay: 5000, initialDelay: 50 });

    // Fire multiple execute calls concurrently
    const p1 = rl.execute(async () => 'a');
    const p2 = rl.execute(async () => 'b');
    const p3 = rl.execute(async () => 'c');

    await vi.runAllTimersAsync();

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBe('a');
    expect(r2).toBe('b');
    expect(r3).toBe('c');
  });

  // Test 14: reset() restores initial state
  it('reset restores initial delay and first-call behavior', async () => {
    const rl = new RateLimiter({ minDelay: 100, maxDelay: 120000, initialDelay: 100 });

    // Execute to change state
    const p1 = rl.execute(async () => 'ok');
    await vi.runAllTimersAsync();
    await p1;

    // Reset
    rl.reset();
    expect(rl.getCurrentDelay()).toBe(100);

    // After reset, next call should skip delay (isFirstCall=true again)
    const startTime = Date.now();
    const p2 = rl.execute(async () => 'reset-ok');
    // Should resolve without timer advancement (first call skips delay)
    const result = await p2;
    expect(result).toBe('reset-ok');
    expect(Date.now() - startTime).toBeLessThan(50);
  });

  // Test 15: Rapid 429s don't cause infinite loop — max 5 retries
  it('rapid 429s stop after max retries', async () => {
    const rl = new RateLimiter({ minDelay: 50, maxDelay: 120000, initialDelay: 50 });

    // Always return 429
    const fn = vi.fn().mockImplementation(async () => {
      const err: any = new Error('Rate limited');
      err.status = 429;
      err.retryAfter = 1;
      throw err;
    });

    // Capture rejection immediately to prevent unhandled rejection warning
    const p = rl.execute(fn).catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    // Should reject after max retries (6 total attempts: 0..5)
    const error = await p;
    expect(error).toBeInstanceOf(Error);
    expect(fn).toHaveBeenCalledTimes(6); // attempts 0 through 5
  });

  // Test 16: onWait callback is called with delay duration before each wait
  it('onWait callback is called with delay duration', async () => {
    const rl = new RateLimiter({ minDelay: 100, maxDelay: 120000, initialDelay: 500 });
    const waitDelays: number[] = [];

    const fn = vi.fn().mockResolvedValue('ok');

    // First call: no wait (isFirstCall = true)
    const p1 = rl.execute(fn, { onWait: (d) => waitDelays.push(d) });
    await vi.runAllTimersAsync();
    await p1;

    // onWait should NOT have been called for the first call
    expect(waitDelays).toHaveLength(0);

    // Second call: should wait currentDelay ms and call onWait
    const p2 = rl.execute(fn, { onWait: (d) => waitDelays.push(d) });
    await vi.runAllTimersAsync();
    await p2;

    // onWait should have been called once with the delay value
    expect(waitDelays).toHaveLength(1);
    // After first success: max(100, floor(500 * 0.9)) = 450
    expect(waitDelays[0]).toBe(450);
  });
});
