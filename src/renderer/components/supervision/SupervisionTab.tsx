import React, { createContext, useContext } from 'react'
import { SupervisionScreen, type SupervisionScreenProps } from './SupervisionScreen.js'

// The console is a view, not a drawer.
//
// It was a bottom-up panel whose height followed its content, so every tab
// opened at a different size and none of them could be dismissed the way the
// rest of the app is. It is now a global tab like Overview: one place, one
// size, and the sidebar and Escape behave exactly as they do everywhere else.
//
// The props come through context rather than the registry, because the hook
// behind them polls and holds subscriptions — App owns the single instance,
// and this reads it.

const SupervisionContext = createContext<SupervisionScreenProps | null>(null)

export function SupervisionProvider({
  value,
  children,
}: {
  value: SupervisionScreenProps
  children: React.ReactNode
}): JSX.Element {
  return <SupervisionContext.Provider value={value}>{children}</SupervisionContext.Provider>
}

/**
 * The registered global tab. Rendered by the shell with no props, so it takes
 * them from the provider App wraps the tree in.
 */
export function SupervisionTab(): JSX.Element {
  const props = useContext(SupervisionContext)
  if (props === null) {
    // Reachable only if the tab is rendered outside the app shell, which would
    // be a wiring mistake — stated rather than a blank screen.
    return <div className="sv-allclear">Supervision is not available in this window.</div>
  }
  return <SupervisionScreen {...props} />
}
