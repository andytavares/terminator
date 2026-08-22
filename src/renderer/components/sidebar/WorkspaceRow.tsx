import React, { useState } from 'react'
import type { Workspace } from '../../../shared/types/index'
import { ContextMenu, closeAllContextMenus } from '../ContextMenu'
import './WorkspaceRow.css'

export interface WorkspaceRowProps {
  workspace: Workspace
  onAddProject: () => void
  onEdit: () => void
  onRemove: () => void
}

/**
 * The workspace's home in the flat list.
 *
 * Grouping by project means a workspace has no header of its own, so without
 * this row the workspace-level actions the tree's card carried — edit, remove,
 * the colour band, the tags — would have nowhere to live and simply disappear.
 * It sits under that workspace's groups and is present in every grouping mode.
 */
export function WorkspaceRow({
  workspace,
  onAddProject,
  onEdit,
  onRemove,
}: WorkspaceRowProps): JSX.Element {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  return (
    <>
      <div
        className="ws-row"
        style={{ ['--ws-color' as string]: workspace.color } as React.CSSProperties}
        onContextMenu={(e) => {
          e.preventDefault()
          closeAllContextMenus()
          setCtxMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        <span className="ws-row__band" />
        <button className="ws-row__add" onClick={onAddProject}>
          <span className="ws-row__plus">+</span>
          <span>New project in </span>
          <span className="ws-row__name">{workspace.name}</span>
        </button>
        {workspace.tags.map((tag) => (
          <span key={tag} className="ws-row__tag">
            {tag}
          </span>
        ))}
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onDismiss={() => setCtxMenu(null)}
          items={[
            {
              label: 'Edit workspace',
              onSelect: () => {
                setCtxMenu(null)
                onEdit()
              },
            },
            {
              label: 'Remove workspace',
              danger: true,
              separatorBefore: true,
              onSelect: () => {
                setCtxMenu(null)
                onRemove()
              },
            },
          ]}
        />
      )}
    </>
  )
}
