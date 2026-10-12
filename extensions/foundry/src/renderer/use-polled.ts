import { useEffect } from 'react'

/**
 * Calls `tick` every `intervalMs` while the view is visible, and not at all
 * while it is hidden; coming back to visible ticks once at once. Returns what
 * stops it.
 */
export function everyWhileVisible(tick: () => void, intervalMs: number): () => void {
  let timer: ReturnType<typeof setInterval> | null = null
  const start = (): void => {
    timer ??= setInterval(tick, intervalMs)
  }
  const stop = (): void => {
    if (timer !== null) clearInterval(timer)
    timer = null
  }
  const onVisibility = (): void => {
    if (document.hidden) {
      stop()
      return
    }
    tick()
    start()
  }
  if (!document.hidden) start()
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    stop()
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

/**
 * The fallback poll, for data that changes without Foundry writing anything:
 * what an agent's transcript says, a pull request's CI. Everything Foundry
 * does write is pushed instead (`usePushed`).
 *
 * Read now, then every `intervalMs` while mounted and visible, and hand each
 * answer to `show`. Reading and showing are separate so that state is only set
 * in the callback of a read — never synchronously in the effect body.
 */
export function usePolled<T>(
  read: () => Promise<T>,
  show: (answer: T) => void,
  intervalMs: number
): void {
  useEffect(() => {
    let mounted = true
    const poll = (): void =>
      void read().then((answer) => {
        if (mounted) show(answer)
      })
    poll()
    const stop = everyWhileVisible(poll, intervalMs)
    return () => {
      mounted = false
      stop()
    }
  }, [read, show, intervalMs])
}
