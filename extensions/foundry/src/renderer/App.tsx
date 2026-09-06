import React, { useEffect, useState } from 'react'
import { Settings, ArrowLeft } from 'lucide-react'
import { Inbox } from '../components/Inbox.js'
import { Orders } from '../components/Orders.js'
import { Ledger } from '../components/Ledger.js'
import { SettingsView } from '../components/SettingsView.js'

// Three surfaces, and a way into settings.
//
// The inbox is home because it is the one surface the operator is required to
// visit: everything a rule raises reaches them there, ranked by how much work
// it unblocks. The Forge is where an idea becomes an agreed order, and where
// an order that is already running is watched. The Ledger is the record, and
// the only place the factory ever argues back — on request.
//
// What used to be here — a board, a card drawer, a phase rail, a new-card
// dialog and a ticket importer — went with the pipeline underneath it. A board
// is a place to notice things; an inbox is a place things come to.

type Surface = 'inbox' | 'forge' | 'ledger'

const SURFACES: readonly { id: Surface; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'forge', label: 'Forge' },
  { id: 'ledger', label: 'Ledger' },
]

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
          {SURFACES.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={surface === tab.id ? 'is-on' : ''}
              aria-pressed={surface === tab.id}
              onClick={() => setSurface(tab.id)}
            >
              {tab.label}
            </button>
          ))}
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
        ) : surface === 'ledger' ? (
          <Ledger />
        ) : (
          <Orders repoRoot={repoRoot} />
        )}
      </div>
    </div>
  )
}
