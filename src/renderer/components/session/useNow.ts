import { useEffect, useState } from 'react'

const DEFAULT_REFRESH_MS = 30_000

/** The current time, read outside render and refreshed on an interval so relative ages stay true. */
export function useNow(refreshMs: number = DEFAULT_REFRESH_MS): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), refreshMs)
    return () => clearInterval(timer)
  }, [refreshMs])
  return now
}
