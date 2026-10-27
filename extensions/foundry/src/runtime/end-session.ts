/**
 * Stop a session and wait, within bounds, until it ends.
 *
 * True when it is gone. False when it outlived the timeout — the caller goes on
 * either way; this only keeps two processes off one conversation in the
 * ordinary case.
 */
export async function endAndWait(
  deps: {
    stop(sessionId: string, reason: string): boolean
    isLive(sessionId: string): boolean
    /** Calls the listener once the session ends; returns how to stop listening. */
    onEnd(sessionId: string, listener: () => void): () => void
  },
  { sessionId, reason }: { sessionId: string; reason: string },
  opts: { timeoutMs?: number } = {}
): Promise<boolean> {
  if (!deps.isLive(sessionId)) return true
  let detach = (): void => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  const ended = new Promise<boolean>((resolve) => {
    detach = deps.onEnd(sessionId, () => resolve(true))
    timer = setTimeout(() => resolve(false), opts.timeoutMs ?? 15_000)
  })
  deps.stop(sessionId, reason)
  try {
    return await ended
  } finally {
    detach()
    clearTimeout(timer)
  }
}
