import React, { useEffect } from 'react'
import { useSettingsStore } from './stores/settings.store'
import { useExtensionRegistry } from './extensions/registry'
import { ToastContainer } from './components/ToastContainer'
import { ErrorBoundary } from './components/ErrorBoundary'

export function ExtensionWindowView({ view }: { view: string }): JSX.Element {
  const { loadSettings, resolvedTheme } = useSettingsStore()
  const params = new URLSearchParams(window.location.search)
  const repoRoot = params.get('repoRoot')
  const accentColor = params.get('accentColor')
  const windowViews = useExtensionRegistry((s) => s.windowViews)
  const ViewComponent = windowViews.get(view)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme)
  }, [resolvedTheme])

  return (
    <ErrorBoundary>
      <div
        style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}
      >
        {accentColor && <div style={{ height: 3, background: accentColor, flexShrink: 0 }} />}
        {ViewComponent ? (
          <ViewComponent repoRoot={repoRoot} />
        ) : (
          <div>Extension view not found: {view}</div>
        )}
        <ToastContainer />
      </div>
    </ErrorBoundary>
  )
}
