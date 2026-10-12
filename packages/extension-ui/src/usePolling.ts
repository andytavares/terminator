import { useEffect } from 'react'

/**
 * Read now, then every `intervalMs` while mounted, and hand each answer to
 * `show`. Reading and showing are separate so that state is only set in the
 * callback of a read — never synchronously in the effect body.
 */
export function usePolling<T>(
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
    const timer = setInterval(poll, intervalMs)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [read, show, intervalMs])
}
