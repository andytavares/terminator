import { useShallow } from 'zustand/react/shallow'
import React, { createElement, useEffect } from 'react'
import { useSettingsStore } from './stores/settings.store'
import { useExtensionRegistry } from './extensions/registry'
import { ToastContainer } from './components/ToastContainer'
import { ErrorBoundary } from './components/ErrorBoundary'

/** Loads the settings and follows their theme, as the main window does. */
function useWindowTheme(): void {
  const { loadSettings, resolvedTheme } = useSettingsStore(
    useShallow((s) => ({ loadSettings: s.loadSettings, resolvedTheme: s.resolvedTheme }))
  )

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme)
  }, [resolvedTheme])
}

export function ExtensionWindowView({ view }: { view: string }): React.JSX.Element {
  useWindowTheme()
  const params = new URLSearchParams(window.location.search)
  const repoRoot = params.get('repoRoot')
  const accentColor = params.get('accentColor')
  const windowViews = useExtensionRegistry((s) => s.windowViews)
  const ViewComponent = windowViews.get(view)

  return (
    <ErrorBoundary>
      <div
        style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}
      >
        {accentColor && <div style={{ height: 3, background: accentColor, flexShrink: 0 }} />}
        {ViewComponent ? (
          createElement(ViewComponent, { repoRoot })
        ) : (
          <div>Extension view not found: {view}</div>
        )}
        <ToastContainer />
      </div>
    </ErrorBoundary>
  )
}
