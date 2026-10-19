import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useMetricsStore } from '../stores/metrics.store'
import { useExtensionRegistry } from '../extensions/registry'
import { MetricsBar } from './overview/MetricsBar'
import { SessionLinkDialog } from './session/SessionLinkDialog'
import { useSessionFacts } from './session/useSessionFacts'
import { useDeskAskCount } from './home/useDeskModel'

// Each part below reads a store that changes every second while a terminal is
// busy or metrics are on. Kept out of App so that only the part re-renders.

/** Keeps Home's badge on the number of things waiting on the operator. */
export function HomeBadge(): null {
  const needsYouCount = useDeskAskCount()
  // App registers Home in its own effect, which runs after this child's, so
  // the badge is written again once Home is there.
  const homeRegistered = useExtensionRegistry((s) => s.globalTabs.has('core.home'))
  useEffect(() => {
    useExtensionRegistry.getState().updateGlobalTab('core.home', {
      badge: needsYouCount,
      badgeLabel: `${needsYouCount} need you`,
    })
  }, [needsYouCount, homeRegistered])
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
