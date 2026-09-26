/**
 * Stop a session and wait, within bounds, until it is gone.
 *
 * True when it is gone. False when it outlived the timeout — the caller goes on
 * either way; this only keeps two processes off one conversation in the
 * ordinary case.
 */
export async function endAndWait(
  deps: {
    stop(sessionId: string, reason: string): boolean
    isLive(sessionId: string): boolean
    sleep?: (ms: number) => Promise<void>
  },
  sessionId: string,
  reason: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<boolean> {
  if (!deps.isLive(sessionId)) return true
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const timeoutMs = opts.timeoutMs ?? 15_000
  const intervalMs = opts.intervalMs ?? 250
  deps.stop(sessionId, reason)
  for (let waited = 0; waited < timeoutMs; waited += intervalMs) {
    await sleep(intervalMs)
    if (!deps.isLive(sessionId)) return true
  }
  return false
}
