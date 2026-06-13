import React from 'react'
import { Bell } from 'lucide-react'
import type { GlobalTabRegistration } from '../../extensions/registry'
import { SidebarSearch } from './SidebarSearch'
import './SidebarHeader.css'

interface SidebarHeaderProps {
  globalTabs: GlobalTabRegistration[]
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
  activeGlobalTabId,
  onSelectGlobalTab,
  onAddWorkspace,
  unreadNotifications = 0,
  onBellClick,
  searchQuery = '',
  onSearchChange,
  onSearchClear,
}: SidebarHeaderProps): JSX.Element {
  const visibleTabs = globalTabs.filter((t) => !t.hidden)

  return (
    <div className="sidebar-header">
      <SidebarSearch
        query={searchQuery}
        onChange={onSearchChange ?? (() => {})}
        onClear={onSearchClear ?? (() => {})}
      />
      <div className="sidebar-header__actions">
        <div className="sidebar-header__tabs">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              className={`sidebar-header__tab${activeGlobalTabId === tab.id ? ' sidebar-header__tab--active' : ''}`}
              onClick={() => onSelectGlobalTab(tab.id)}
              title={tab.label}
            >
              {tab.icon ?? tab.label[0]}
            </button>
          ))}
        </div>
        <div className="sidebar-header__fixed-actions">
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
          <button className="sidebar-header__add" onClick={onAddWorkspace} title="New workspace">
            +
          </button>
        </div>
      </div>
    </div>
  )
}
