import React, { useEffect, useState } from 'react'
import { Settings, ArrowLeft } from 'lucide-react'
import { Inbox } from '../components/Inbox.js'
import { Orders } from '../components/Orders.js'
import { SettingsView } from '../components/SettingsView.js'

// Two surfaces, and a way into settings.
//
// The inbox is home because it is the one surface the operator is required to
// visit: everything a rule raises reaches them there, ranked by how much work
// it unblocks. The Forge is where an idea becomes an agreed order, and where
// an order that is already running is watched.
//
// What used to be here — a board, a card drawer, a phase rail, a new-card
// dialog and a ticket importer — went with the pipeline underneath it. A board
// is a place to notice things; an inbox is a place things come to.

type Surface = 'inbox' | 'forge'

export function App(): JSX.Element {
  const [repoRoot, setRepoRoot] = useState<string | null>(
    new URLSearchParams(window.location.search).get('repoRoot')
  )
  const [surface, setSurface] = useState<Surface>('inbox')
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Orders are per-repository, so a workspace switch resets the surfaces.
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('workspace:changed', (data: unknown) => {
      const d = data as { repoRoot?: string | null }
      setRepoRoot(d.repoRoot ?? null)
      setSettingsOpen(false)
    })
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <header className="sk-appbar">
        <span className="sk-appbar__title">Foundry</span>
        <nav className="fdry-tabs" aria-label="Foundry surfaces">
          <button
            type="button"
            className={surface === 'inbox' ? 'is-on' : ''}
            aria-pressed={surface === 'inbox'}
            onClick={() => setSurface('inbox')}
          >
            Inbox
          </button>
          <button
            type="button"
            className={surface === 'forge' ? 'is-on' : ''}
            aria-pressed={surface === 'forge'}
            onClick={() => setSurface('forge')}
          >
            Forge
          </button>
        </nav>
        <button
          aria-label="Settings"
          className="sk-btn"
          style={{ marginLeft: 'auto' }}
          onClick={() => setSettingsOpen(true)}
        >
          <Settings aria-hidden="true" />
        </button>
      </header>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {settingsOpen ? (
          <div className="sk-settings-wrap">
            <button aria-label="Back" className="sk-btn" onClick={() => setSettingsOpen(false)}>
              <ArrowLeft aria-hidden="true" /> Back
            </button>
            <SettingsView />
          </div>
        ) : surface === 'inbox' ? (
          <Inbox />
        ) : (
          <Orders repoRoot={repoRoot} />
        )}
      </div>
    </div>
  )
}
