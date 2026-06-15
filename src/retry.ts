/**
 * @module retry
 * A focused retry helper. IndexedDB operations are usually deterministic, but a
 * handful of failures (a transaction losing liveness under contention, a
 * transient `UnknownError`) are worth retrying. By default only those are.
 */
import { isRetryable } from './errors.js';

/** Options for {@link withRetry}. */
export interface RetryOptions {
  /** Maximum attempts beyond the first. Defaults to `3`. */
  retries?: number;
  /** Initial backoff in milliseconds. Defaults to `50`. */
  minDelay?: number;
  /** Maximum backoff in milliseconds. Defaults to `2000`. */
  maxDelay?: number;
  /** Backoff multiplier per attempt. Defaults to `2`. */
  factor?: number;
  /**
   * Decide whether a given error should be retried. Defaults to
   * {@link isRetryable}, which retries only plausibly-transient failures.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Invoked before each retry; useful for logging or metrics. */
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
  /** Abort the retry loop early. */
  signal?: AbortSignal;
}

function delayFor(attempt: number, options: Required<Pick<RetryOptions, 'minDelay' | 'maxDelay' | 'factor'>>): number {
  const base = options.minDelay * options.factor ** attempt;
  const capped = Math.min(base, options.maxDelay);
  // Full jitter spreads out concurrent retries to avoid thundering herds.
  return Math.random() * capped;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('Aborted'));
      },
      { once: true },
    );
  });
}

/**
 * Run `operation`, retrying on transient failures with exponential backoff.
 *
 * @param operation - The async function to attempt. Receives the attempt index.
 * @param options - Retry tuning. See {@link RetryOptions}.
 * @returns The resolved value of the first successful attempt.
 *
 * @example
 * const user = await withRetry(() => users.get('u1'), { retries: 5 });
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? 3;
  const minDelay = options.minDelay ?? 50;
  const maxDelay = options.maxDelay ?? 2000;
  const factor = options.factor ?? 2;
  const shouldRetry = options.shouldRetry ?? ((error) => isRetryable(error));

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error, attempt)) {
        throw error;
      }
      const wait = delayFor(attempt, { minDelay, maxDelay, factor });
      options.onRetry?.(error, attempt + 1, wait);
      await sleep(wait, options.signal);
      attempt += 1;
    }
  }
}
