import React, { useState, useEffect } from 'react'
import { WorkspaceItem } from './WorkspaceItem'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import { useWorkspaceStore } from '../../stores/workspace.store'
import './Sidebar.css'

interface ExtSidebarItem {
  id: string
  label: string
  tooltip?: string
}

export function Sidebar(): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [extItems, setExtItems] = useState<ExtSidebarItem[]>([])
  const { workspaces } = useWorkspaceStore()

  useEffect(() => {
    window.electronAPI.extension.getSidebarItems().then((r) => setExtItems(r.items ?? []))
  }, [])

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar__header">
        {!collapsed && <span className="sidebar__title">Workspaces</span>}
        <button
          className="sidebar__toggle"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      <div className="sidebar__workspaces">
        {workspaces.map((workspace) => (
          <WorkspaceItem key={workspace.id} workspace={workspace} collapsed={collapsed} />
        ))}
      </div>

      {!collapsed && extItems.length > 0 && (
        <div className="sidebar__ext-items">
          {extItems.map((item) => (
            <button key={item.id} className="sidebar__ext-item" title={item.tooltip}>
              {item.label}
            </button>
          ))}
        </div>
      )}

      {!collapsed && (
        <button className="sidebar__create-btn" onClick={() => setCreateOpen(true)}>
          + Create Workspace
        </button>
      )}

      {createOpen && <CreateWorkspaceDialog onClose={() => setCreateOpen(false)} />}
    </aside>
  )
}
