import type { ContextMenuItem } from '../ContextMenu'

// The issue actions on a project, defined once.
//
// Two menus reach a project: the group header's, when the sidebar is grouped
// by project, and ScopeMenu, when it is grouped by anything else and the row's
// project badge is the only way in. Both need these items, and building them
// twice is how one of them silently ends up missing an action — which is
// exactly what happened when these lived only in ScopeMenu.

export interface IssueMenuActions {
  /** The key attached to this project, or null. Drives which items appear. */
  issueKey?: string | null
  onLinkIssue?: () => void
  onOpenIssue?: () => void
  onCopyIssueKey?: () => void
  onUnlinkIssue?: () => void
}

/**
 * Nothing at all when the host cannot link (no handler), just "Link" when
 * nothing is attached, and the full set once one is. Offering "unlink" and
 * "open" against no issue would be three dead rows.
 */
export function issueMenuItems(actions: IssueMenuActions, dismiss: () => void): ContextMenuItem[] {
  const { issueKey, onLinkIssue, onOpenIssue, onCopyIssueKey, onUnlinkIssue } = actions
  if (onLinkIssue === undefined) return []

  const run = (fn?: () => void) => () => {
    dismiss()
    fn?.()
  }

  if (issueKey == null) {
    return [{ label: 'Link issue…', separatorBefore: true, onSelect: run(onLinkIssue) }]
  }

  return [
    {
      label: `Open ${issueKey} in tracker`,
      separatorBefore: true,
      onSelect: run(onOpenIssue),
    },
    { label: 'Copy issue key', onSelect: run(onCopyIssueKey) },
    { label: 'Change linked issue…', onSelect: run(onLinkIssue) },
    { label: `Unlink ${issueKey}`, onSelect: run(onUnlinkIssue) },
  ]
}
