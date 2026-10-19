import { useEffect, useState } from 'react'
import type { SessionUsage } from '../../../shared/agents/agent-usage'

/** Tokens and cost by session id, for the sessions that ran an agent; empty while unread or unreadable. */
export function useSessionUsage(sessionIds: readonly string[]): Map<string, SessionUsage> {
  const [usage, setUsage] = useState(new Map<string, SessionUsage>())
  const wanted = sessionIds.join(',')

  useEffect(() => {
    let current = true
    const api = window.electronAPI?.agentUsage
    if (!api || wanted === '') return
    void api
      .get({ sessionIds: wanted.split(',') })
      .then((result) => {
        if (current && 'data' in result) {
          setUsage(new Map(result.data.sessions.map((s) => [s.sessionId, s])))
        }
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [wanted])

  return usage
}

/** "1.2M tokens · $3.10": what a session used, counting what it read and wrote. */
export function usageLabel(usage: SessionUsage): string {
  const tokens = usage.tokens.input + usage.tokens.output
  const amount = tokens >= 1e6 ? `${(tokens / 1e6).toFixed(1)}M` : `${Math.round(tokens / 1e3)}k`
  return `${amount} tokens · $${usage.costUsd.toFixed(2)}`
}
