import React, { Suspense, lazy } from 'react'

// Loaded when an agent tab first shows, so the composer, find bar and diff view are their own
// chunk and the main bundle stays under its size limit (electron.vite.config.ts).
const AgentView = lazy(() => import('./AgentView').then((m) => ({ default: m.AgentView })))

/** The agent tab of `sessionId`, loaded on first use. */
export function LazyAgentView({ sessionId }: { sessionId: string }): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <AgentView sessionId={sessionId} />
    </Suspense>
  )
}
