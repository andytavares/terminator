import React from 'react'
import type { WorkspaceTabRegistration } from '../../extensions/registry'
import { ContextMenu } from '../ContextMenu'
import { issueMenuItems, type IssueMenuActions } from './issue-menu-items'

export interface ScopeMenuProps {
  x: number
  y: number
  projectName: string
  /** The issue attached to this project, and what can be done with it. */
  issueActions?: IssueMenuActions
  /** Workspace-scoped extension buttons, offered here as menu items instead. */
  workspaceTabs: WorkspaceTabRegistration[]
  onSelectWorkspaceTab: (tabId: string) => void
  onAddSession: () => void
  onRemoveProject: () => void
  onDismiss: () => void
}

/**
 * The second host for scope actions.
 *
 * When sessions are grouped by something that is not a scope — status, branch,
 * nothing — there is no project header to hang workspace and project actions
 * on. Every row's project badge opens this menu instead, so the same registry
 * data reaches the user without any new contribution type (FR-027, invariant I3).
 */
export function ScopeMenu({
  x,
  y,
  projectName,
  issueActions,
  workspaceTabs,
  onSelectWorkspaceTab,
  onAddSession,
  onRemoveProject,
  onDismiss,
}: ScopeMenuProps): JSX.Element {
  return (
    <ContextMenu
      x={x}
      y={y}
      onDismiss={onDismiss}
      items={[
        {
          label: 'New terminal',
          onSelect: () => {
            onDismiss()
            onAddSession()
          },
        },
        ...issueMenuItems(issueActions ?? {}, onDismiss),
        ...workspaceTabs.map((tab, index) => ({
          label: tab.label,
          separatorBefore: index === 0,
          onSelect: () => {
            onDismiss()
            onSelectWorkspaceTab(tab.id)
          },
        })),
        {
          label: `Remove ${projectName}`,
          danger: true,
          separatorBefore: true,
          onSelect: () => {
            onDismiss()
            onRemoveProject()
          },
        },
      ]}
    />
  )
}
