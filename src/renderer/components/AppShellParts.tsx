import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSessionStore } from '../stores/session.store'
import { useMetricsStore } from '../stores/metrics.store'
import { useExtensionRegistry } from '../extensions/registry'
import { BellAndBusySource } from '../sidebar/agent-state'
import { MetricsBar } from './overview/MetricsBar'
import { SessionLinkDialog } from './session/SessionLinkDialog'
import { useSessionFacts } from './session/useSessionFacts'

// Each part below reads a store that changes every second while a terminal is
// busy or metrics are on. Kept out of App so that only the part re-renders.

/** Counts the sessions waiting on the operator for Home's badge. */
const needsYouSource = new BellAndBusySource()

/** Keeps Home's badge on the number of sessions waiting on the operator. */
export function HomeBadge(): null {
  const { sessions } = useSessionStore(useShallow((s) => ({ sessions: s.sessions })))
  const needsYouCount = useMemo(
    () =>
      [...sessions.values()].filter((s) => needsYouSource.derive(s) === 'awaiting-input').length,
    [sessions]
  )
  useEffect(() => {
    useExtensionRegistry.getState().updateGlobalTab('core.home', {
      badge: needsYouCount,
      badgeLabel: `${needsYouCount} need you`,
    })
  }, [needsYouCount])
  return null
}

export function GlobalMetricsBar(): JSX.Element {
  const { system } = useMetricsStore(useShallow((s) => ({ system: s.system })))
  return (
    <div className="app-global-metrics">
      <MetricsBar system={system} />
    </div>
  )
}

/** The link dialog for one terminal, once its facts are known. */
export function SessionLinkHost(props: {
  sessionId: string
  onClose: () => void
}): JSX.Element | null {
  const facts = useSessionFacts().find((f) => f.sessionId === props.sessionId)
  if (!facts) return null
  return <SessionLinkDialog facts={facts} onClose={props.onClose} />
}
