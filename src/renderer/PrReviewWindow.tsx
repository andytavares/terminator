import React, { useEffect } from 'react'
import { useSettingsStore } from './stores/settings.store'
import { PrReviewTab } from '../../extensions/git-integration/src/components/pr-review/PrReviewTab'
import { ToastContainer } from './components/ToastContainer'
import { ErrorBoundary } from './components/ErrorBoundary'

export function PrReviewWindow(): JSX.Element {
  const { loadSettings, resolvedTheme } = useSettingsStore()
  const params = new URLSearchParams(window.location.search)
  const repoRoot = params.get('repoRoot')
  const accentColor = params.get('accentColor')

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
        <PrReviewTab repoRoot={repoRoot} />
        <ToastContainer />
      </div>
    </ErrorBoundary>
  )
}
