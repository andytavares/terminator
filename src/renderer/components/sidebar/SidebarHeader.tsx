import React from 'react'
import { Plus } from 'lucide-react'
import { SidebarSearch } from './SidebarSearch'
import './SidebarHeader.css'

interface SidebarHeaderProps {
  onSearchFocus: () => void
  onAddWorkspace: () => void
  searchQuery?: string
  onSearchChange?: (q: string) => void
  onSearchClear?: () => void
  /** The Filter and Display menus, which act on the list below. */
  children?: React.ReactNode
}

export function SidebarHeader({
  onAddWorkspace,
  searchQuery = '',
  onSearchChange,
  onSearchClear,
  children,
}: SidebarHeaderProps): JSX.Element {
  return (
    <div className="sidebar-header">
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
