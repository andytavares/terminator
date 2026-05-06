import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import { useSettingsStore } from './stores/settings.store'

function Root(): JSX.Element {
  const theme = useSettingsStore((s) => s.resolvedTheme)
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  React.useEffect(() => {
    window.electronAPI.terminal.cleanupOrphans().catch(() => {})
  }, [])

  return <App />
}

const el = document.getElementById('app')
if (!el) throw new Error('No #app element')
createRoot(el).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
