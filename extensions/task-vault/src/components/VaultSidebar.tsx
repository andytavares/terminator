import React from 'react'
import {
  CalendarDays,
  Inbox,
  FolderOpen,
  Layers,
  Sunset,
  Archive,
  ClipboardList,
} from 'lucide-react'
import { useVaultStore, type VaultView } from '../stores/vault.store'

const NAV_ITEMS: Array<{ view: VaultView; label: string; icon: React.ReactNode }> = [
  { view: 'daily', label: 'Today', icon: <CalendarDays size={15} /> },
  { view: 'inbox', label: 'Inbox', icon: <Inbox size={15} /> },
  { view: 'projects', label: 'Projects', icon: <FolderOpen size={15} /> },
  { view: 'areas', label: 'Areas', icon: <Layers size={15} /> },
  { view: 'someday', label: 'Someday', icon: <Sunset size={15} /> },
  { view: 'archive', label: 'Archive', icon: <Archive size={15} /> },
  { view: 'review', label: 'Weekly Review', icon: <ClipboardList size={15} /> },
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
