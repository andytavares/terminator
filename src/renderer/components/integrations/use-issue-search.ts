import { useShallow } from 'zustand/react/shallow'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useIntegrationsStore } from '../../stores/integrations.store'
import type { IssueListResult, TrackerId } from '../../../shared/types/index'

export const TRACKER_LABELS: Record<TrackerId, string> = { linear: 'Linear', jira: 'Jira' }

export const ERROR_TEXT: Record<string, string> = {
  'not-connected': 'not connected',
  'auth-failed': 'credential rejected',
  'rate-limited': 'rate limited',
  unavailable: 'unreachable',
  'not-found': 'not found',
  failed: 'failed',
}

const SEARCH_DEBOUNCE_MS = 250

/** The operator's own issues for an empty term, a search for any other. */
function useIssueQuery(mineLimit: number | undefined) {
  const { listMine, searchIssues } = useIntegrationsStore(
    useShallow((s) => ({ listMine: s.listMine, searchIssues: s.searchIssues }))
  )
  return useCallback(
    (trimmed: string): Promise<IssueListResult> =>
      trimmed.length === 0
        ? listMine(mineLimit === undefined ? undefined : { limit: mineLimit })
        : searchIssues(trimmed),
    [listMine, searchIssues, mineLimit]
  )
}

/** The issues a picker lists, the search debounced and only the latest answer kept. Nothing is
 * fetched while `enabled` is false. */
export function useIssueSearch(
  term: string,
  enabled: boolean,
  mine?: { limit: number }
): { result: IssueListResult; loading: boolean } {
  const query = useIssueQuery(mine?.limit)
  const [result, setResult] = useState<IssueListResult>({ issues: [], failures: [] })
  // The term the current result answers; null until a result has arrived.
  const [answeredTerm, setAnsweredTerm] = useState<string | null>(null)
  // Guards against a slow earlier request replacing a faster later one.
  const requestId = useRef(0)
  if (!enabled && answeredTerm !== null) setAnsweredTerm(null)

  useEffect(() => {
    if (!enabled) return
    const id = ++requestId.current
    const trimmed = term.trim()
    const run = async (): Promise<void> => {
      const next = await query(trimmed)
      if (id !== requestId.current) return
      setResult(next)
      setAnsweredTerm(trimmed)
    }
    if (trimmed.length === 0) return void run()
    const timer = setTimeout(() => void run(), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term, enabled, query])

  return { result, loading: enabled && answeredTerm !== term.trim() }
}
