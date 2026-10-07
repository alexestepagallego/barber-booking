import { findPgError } from "./errors";

/**
 * SQLSTATEs that mean "this transaction lost a race and was rolled back;
 * running it again is safe and will likely succeed".
 *
 * - 40P01 deadlock_detected: two concurrent INSERTs whose ranges overlap
 *   each other can end up waiting on one another while the exclusion
 *   constraint checks for conflicts. Postgres breaks the cycle by aborting
 *   one of them. No double booking happens, but the victim must be retried
 *   so it gets a real answer (success, or a clean "slot taken").
 * - 40001 serialization_failure: same idea under stricter isolation levels.
 */
const RETRYABLE_CODES = new Set(["40P01", "40001"]);

export function isRetryableTransactionError(error: unknown): boolean {
  const code = findPgError(error)?.code;
  return code !== undefined && RETRYABLE_CODES.has(code);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Re-runs `fn` when it fails with a retryable transaction error, waiting a
 * random, growing delay between attempts so the competing transactions do
 * not collide again in lockstep. Any other error is rethrown immediately.
 */
export async function withTransactionRetry<T>(
  fn: () => Promise<T>,
  { attempts = 5, baseDelayMs = 10 }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !isRetryableTransactionError(error)) throw error;
      await sleep(baseDelayMs * attempt * (0.5 + Math.random()));
    }
  }
}
