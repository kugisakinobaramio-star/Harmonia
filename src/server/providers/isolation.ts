/**
 * Provider isolation helpers.
 * Ensures one slow or failing provider cannot starve the whole search.
 * All providers remain enabled; this only improves reliability.
 */

export interface TimedResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
  durationMs: number;
}

/**
 * Run a provider task with a hard timeout.
 * Rejects are converted to a timed failure so Promise.allSettled-style
 * aggregation stays simple and safe.
 */
export async function runProviderTask<T>(
  label: string,
  task: () => Promise<T>,
  timeoutMs: number,
): Promise<TimedResult<T>> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      task().then((value) => ({ ok: true as const, value })),
      new Promise<{ ok: false; error: string }>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, error: `${label} timed out after ${timeoutMs}ms` }),
          timeoutMs,
        );
      }),
    ]);

    const durationMs = Date.now() - started;
    if (result.ok) {
      return { ok: true, value: result.value, durationMs };
    }
    return { ok: false, error: result.error, durationMs };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `${label}: ${message}`, durationMs };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Soft circuit: track consecutive failures per provider (in-memory, best-effort). */
const failureCounts = new Map<string, { count: number; lastFailureAt: number }>();

const CIRCUIT_WINDOW_MS = 60_000;
const CIRCUIT_THRESHOLD = 8;

export function recordProviderFailure(providerId: string): void {
  const now = Date.now();
  const prev = failureCounts.get(providerId);
  if (!prev || now - prev.lastFailureAt > CIRCUIT_WINDOW_MS) {
    failureCounts.set(providerId, { count: 1, lastFailureAt: now });
    return;
  }
  failureCounts.set(providerId, { count: prev.count + 1, lastFailureAt: now });
}

export function recordProviderSuccess(providerId: string): void {
  failureCounts.delete(providerId);
}

/** Returns true when the provider should be skipped for a short period. */
export function isProviderCircuitOpen(providerId: string): boolean {
  const entry = failureCounts.get(providerId);
  if (!entry) return false;
  if (Date.now() - entry.lastFailureAt > CIRCUIT_WINDOW_MS) {
    failureCounts.delete(providerId);
    return false;
  }
  return entry.count >= CIRCUIT_THRESHOLD;
}

export function getProviderFailureSnapshot(): Record<string, { count: number; lastFailureAt: number }> {
  const out: Record<string, { count: number; lastFailureAt: number }> = {};
  for (const [id, value] of failureCounts) {
    out[id] = { ...value };
  }
  return out;
}
