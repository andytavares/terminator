import { useEffect } from 'react'

/** Counts one use of a screen each time it is shown. Render it inside the screen. */
export function RecordShown({ feature }: { readonly feature: string }): null {
  useEffect(() => {
    window.electronAPI.usage.record(feature)
  }, [feature])
  return null
}
