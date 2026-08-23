import React from 'react'
import type { WorkspaceTabRegistration } from '../../extensions/registry'
import { ContextMenu } from '../ContextMenu'

export interface ScopeMenuProps {
  x: number
  y: number
  projectName: string
  /** The issue attached to this project, if any. */
  issueKey?: string | null
  onLinkIssue?: () => void
  onOpenIssue?: () => void
  onCopyIssueKey?: () => void
  onUnlinkIssue?: () => void
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
  issueKey,
  onLinkIssue,
  onOpenIssue,
  onCopyIssueKey,
  onUnlinkIssue,
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
        // Only "link" when there is nothing attached: offering "unlink" and
        // "open" against no issue is four dead rows.
        ...(onLinkIssue === undefined
          ? []
          : issueKey == null
            ? [
                {
                  label: 'Link issue…',
                  separatorBefore: true,
                  onSelect: () => {
                    onDismiss()
                    onLinkIssue()
                  },
                },
              ]
            : [
                {
                  label: `Open ${issueKey} in tracker`,
                  separatorBefore: true,
                  onSelect: () => {
                    onDismiss()
                    onOpenIssue?.()
                  },
                },
                {
                  label: 'Copy issue key',
                  onSelect: () => {
                    onDismiss()
                    onCopyIssueKey?.()
                  },
                },
                {
                  label: 'Change linked issue…',
                  onSelect: () => {
                    onDismiss()
                    onLinkIssue()
                  },
                },
                {
                  label: `Unlink ${issueKey}`,
                  onSelect: () => {
                    onDismiss()
                    onUnlinkIssue?.()
                  },
                },
              ]),
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
