import React from 'react'
import { useVaultStore, type VaultView } from '../stores/vault.store'

const NAV_ITEMS: Array<{ view: VaultView; label: string }> = [
  { view: 'daily', label: 'Today' },
  { view: 'inbox', label: 'Inbox' },
  { view: 'projects', label: 'Projects' },
  { view: 'areas', label: 'Areas' },
  { view: 'archive', label: 'Archive' },
  { view: 'review', label: 'Weekly Review' },
]

export function VaultSidebar(): React.JSX.Element {
  const { activeView, inboxCount, setView } = useVaultStore()

  return (
    <nav className="vault-sidebar">
      {NAV_ITEMS.map(({ view, label }) => (
        <button
          key={view}
          className={`vault-sidebar__item${activeView === view ? ' vault-sidebar__item--active' : ''}`}
          onClick={() => setView(view)}
        >
          {label}
          {view === 'inbox' && inboxCount > 0 && (
            <span className="vault-sidebar__badge">{inboxCount}</span>
          )}
        </button>
      ))}
    </nav>
  )
}
