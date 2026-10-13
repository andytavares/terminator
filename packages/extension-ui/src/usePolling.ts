import { useEffect } from 'react'

/** Calls `tick` every `intervalMs` while the view is visible, and not at all while it is hidden;
 * coming back to visible ticks once at once. Returns what stops it. */
export function everyWhileVisible(tick: () => void, intervalMs: number): () => void {
  let timer: ReturnType<typeof setInterval> | null = null
  const startTicking = (): void => {
    timer ??= setInterval(tick, intervalMs)
  }
  const stopTicking = (): void => {
    if (timer !== null) clearInterval(timer)
    timer = null
  }
  const followVisibility = (): void => {
    if (document.hidden) {
      stopTicking()
      return
    }
    tick()
    startTicking()
  }
  if (!document.hidden) startTicking()
  document.addEventListener('visibilitychange', followVisibility)
  return () => {
    stopTicking()
    document.removeEventListener('visibilitychange', followVisibility)
  }
}

/** Polls data nothing announces a change of (data with a change event belongs on that event):
 * reads now, then every `intervalMs` while mounted and visible, handing each answer to `show`, so
 * state is set only in a read's callback, never synchronously in the effect body. */
export function usePolling<T>(
  read: () => Promise<T>,
  show: (answer: T) => void,
  intervalMs: number
): void {
  useEffect(() => {
    let mounted = true
    const readAndShow = (): void =>
      void read().then((answer) => {
        if (mounted) show(answer)
      })
    readAndShow()
    const stopTicking = everyWhileVisible(readAndShow, intervalMs)
    return () => {
      mounted = false
      stopTicking()
    }
  }, [read, show, intervalMs])
}
