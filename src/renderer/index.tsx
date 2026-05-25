import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ExtensionWindowView } from './ExtensionWindowView'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import './styles.css'
import { useSettingsStore } from './stores/settings.store'
import { initExtensions } from './extensions/loader'
import { installLogInterceptor } from './logger'

installLogInterceptor()

const view = new URLSearchParams(window.location.search).get('view')

function Root(): JSX.Element {
  const theme = useSettingsStore((s) => s.resolvedTheme)
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  React.useEffect(() => {
    if (!view || view === 'main') {
      window.electronAPI.terminal.cleanupOrphans().catch(() => {})
    }
  }, [])

  if (view && view !== 'main') return <ExtensionWindowView view={view} />
  return <App />
}

const el = document.getElementById('app')
if (!el) throw new Error('No #app element')

// Load only the renderers for active extensions before mounting so no
// extension UI appears for extensions that are not installed.
initExtensions()
  .catch(() => {})
  .finally(() => {
    createRoot(el).render(
      <React.StrictMode>
        <Root />
      </React.StrictMode>
    )
  })
