import React from 'react'
import { CalendarDays, Inbox, FolderOpen, Layers, Archive, ClipboardList } from 'lucide-react'
import { useVaultStore, type VaultView } from '../stores/vault.store'

const NAV_ITEMS: Array<{ view: VaultView; label: string; icon: React.ReactNode }> = [
  { view: 'daily', label: 'Today', icon: <CalendarDays className="tm-icon-lg" /> },
  { view: 'inbox', label: 'Inbox', icon: <Inbox className="tm-icon-lg" /> },
  { view: 'projects', label: 'Projects', icon: <FolderOpen className="tm-icon-lg" /> },
  { view: 'areas', label: 'Areas', icon: <Layers className="tm-icon-lg" /> },
  { view: 'archive', label: 'History', icon: <Archive className="tm-icon-lg" /> },
  { view: 'review', label: 'Weekly review', icon: <ClipboardList className="tm-icon-lg" /> },
]

export function VaultSidebar(): React.JSX.Element {
  const { activeView, inboxCount, setView } = useVaultStore()

  return (
    <nav className="vault-sidebar">
      {NAV_ITEMS.map(({ view, label, icon }) => (
        <button
          key={view}
          className={`vault-sidebar__item${activeView === view ? ' vault-sidebar__item--active' : ''}`}
          onClick={() => setView(view)}
        >
          <span className="vault-sidebar__item-icon">{icon}</span>
          <span className="vault-sidebar__item-label">{label}</span>
          {view === 'inbox' && inboxCount > 0 && (
            <span className="vault-sidebar__badge">{inboxCount}</span>
          )}
        </button>
      ))}
    </nav>
  )
}
