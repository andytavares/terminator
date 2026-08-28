import React from 'react'
import { Bell, Plus } from 'lucide-react'
import type { GlobalTabRegistration, SidebarButtonRegistration } from '../../extensions/registry'
import { AppBand } from './AppBand'
import { SidebarSearch } from './SidebarSearch'
import './SidebarHeader.css'

interface SidebarHeaderProps {
  globalTabs: GlobalTabRegistration[]
  /** Contributed sidebar items, drawn in the same band as the global tabs. */
  sidebarItems: SidebarButtonRegistration[]
  activeGlobalTabId: string | null
  onSelectGlobalTab: (id: string) => void
  onSearchFocus: () => void
  onAddWorkspace: () => void
  unreadNotifications?: number
  onBellClick?: () => void
  searchQuery?: string
  onSearchChange?: (q: string) => void
  onSearchClear?: () => void
}

export function SidebarHeader({
  globalTabs,
  sidebarItems,
  activeGlobalTabId,
  onSelectGlobalTab,
  onAddWorkspace,
  unreadNotifications = 0,
  onBellClick,
  searchQuery = '',
  onSearchChange,
  onSearchClear,
}: SidebarHeaderProps): JSX.Element {
  return (
    <div className="sidebar-header">
      {/* App-level destinations first, ruled off from the list. The bell and
          the add control belong with the list they act on, not up here. */}
      <AppBand
        globalTabs={globalTabs}
        sidebarItems={sidebarItems}
        activeId={activeGlobalTabId}
        onSelect={onSelectGlobalTab}
      />

      <div className="sidebar-header__search-row">
        <SidebarSearch
          query={searchQuery}
          onChange={onSearchChange ?? (() => {})}
          onClear={onSearchClear ?? (() => {})}
        />
        <button
          className={`sidebar-header__bell${unreadNotifications > 0 ? ' sidebar-header__bell--unread' : ''}`}
          onClick={onBellClick}
          title="Notifications"
          aria-label={`Notifications${unreadNotifications > 0 ? ` (${unreadNotifications} unread)` : ''}`}
        >
          <Bell />
          {unreadNotifications > 0 && (
            <span className="sidebar-header__bell-badge">
              {unreadNotifications > 9 ? '9+' : unreadNotifications}
            </span>
          )}
        </button>
        <button
          className="sidebar-header__add"
          onClick={onAddWorkspace}
          title="New repo"
          aria-label="New repo"
        >
          <Plus />
        </button>
      </div>
    </div>
  )
}
