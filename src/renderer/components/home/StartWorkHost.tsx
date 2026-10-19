import React, { Suspense, lazy } from 'react'
import { useStartWorkStore } from './start-work'

// Opened on demand, so the launcher is its own chunk (https://react.dev/reference/react/lazy).
const StartWork = lazy(() => import('./StartWork').then((m) => ({ default: m.StartWork })))

/** Mounts the launcher while ⌘N, Quick actions or the Home button has it open. */
export function StartWorkHost(): JSX.Element | null {
  const { open, closeLauncher } = useStartWorkStore()
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <StartWork onClose={closeLauncher} />
    </Suspense>
  )
}
