/**
 * Thread State — maintains per-conversation state
 * so Copilot Chat messages within the same thread
 * can share data between agent invocations.
 *
 * E.g., /analyze stores requirements, then /design reads them.
 */

const threadStates = new Map<string, Map<string, unknown>>();

// Auto-expire threads after 1 hour
const THREAD_TTL_MS = 60 * 60 * 1000;
const threadTimestamps = new Map<string, number>();

export function getThreadState<T = unknown>(
  threadId: string,
  key: string
): T | undefined {
  cleanup();
  return threadStates.get(threadId)?.get(key) as T | undefined;
}

export function setThreadState(
  threadId: string,
  key: string,
  value: unknown
): void {
  if (!threadStates.has(threadId)) {
    threadStates.set(threadId, new Map());
  }
  threadStates.get(threadId)!.set(key, value);
  threadTimestamps.set(threadId, Date.now());
}

export function clearThreadState(threadId: string): void {
  threadStates.delete(threadId);
  threadTimestamps.delete(threadId);
}

function cleanup(): void {
  const now = Date.now();
  for (const [threadId, ts] of threadTimestamps) {
    if (now - ts > THREAD_TTL_MS) {
      threadStates.delete(threadId);
      threadTimestamps.delete(threadId);
    }
  }
}
