import { useRef } from 'react'
import { useExtensionRegistry } from '../extensions/registry'

type Surfaces = readonly [string | null, string | null, string | null]

function activeSurfaces(): Surfaces {
  const s = useExtensionRegistry.getState()
  return [s.activeGlobalTabId, s.activeWorkspaceTabId, s.activeProjectTabId]
}

/**
 * Click handlers for chrome outside the main area: a click there dismisses the
 * surface covering the terminal (an extension, Home, Overview).
 *
 * A click that itself chose a surface — opening a tab, toggling one off,
 * selecting a session — is left to stand, so the state is compared across the
 * click rather than cleared before it.
 */
export function useDismissSurfaceOnClick(): {
  onClickCapture: () => void
  onClick: () => void
} {
  const before = useRef<Surfaces>([null, null, null])
  return {
    onClickCapture: () => {
      before.current = activeSurfaces()
    },
    onClick: () => {
      const now = activeSurfaces()
      if (before.current.every((id, i) => id === now[i])) {
        useExtensionRegistry.getState().dismissSurfaces()
      }
    },
  }
}
