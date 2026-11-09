import { useEffect } from 'react'

/** Calls `close` when Escape is pressed anywhere in the window. */
export function useCloseOnEscape(close: () => void): void {
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [close])
}
