import React from 'react'
import { Plus } from 'lucide-react'
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
  /** The Filter and Display menus, which act on the list below. */
  children?: React.ReactNode
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
  children,
}: SidebarHeaderProps): JSX.Element {
  return (
    <div className="sidebar-header">
      {/* App-level destinations first. The notification bell joins them: it is
          app-level like everything else in the band, and moving it up frees the
          row below for the two menus that replaced four bands of chrome. */}
      <AppBand
        globalTabs={globalTabs}
        sidebarItems={sidebarItems}
        activeId={activeGlobalTabId}
        onSelect={onSelectGlobalTab}
        unreadNotifications={unreadNotifications}
        onBellClick={onBellClick}
      />

      <div className="sidebar-header__search-row">
        <SidebarSearch
          query={searchQuery}
          onChange={onSearchChange ?? (() => {})}
          onClear={onSearchClear ?? (() => {})}
        />
        {children}
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
