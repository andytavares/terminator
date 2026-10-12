import { useState } from 'react'
import type { TerminalSession } from '../../../shared/types/index'
import { staleSessionsKey } from '../../sidebar/view-model'

/**
 * The branch rows read the clock only to decide staleness, so they are handed a
 * time that moves only when the set of stale sessions changes, not every tick.
 */
export function useStalenessClock(
  sessions: TerminalSession[],
  now: number,
  staleAfterMs: number
): number {
  const key = staleSessionsKey(sessions, now, staleAfterMs)
  const [staleness, setStaleness] = useState({ key, at: now })
  if (staleness.key !== key) {
    setStaleness({ key, at: now })
    return now
  }
  return staleness.at
}
