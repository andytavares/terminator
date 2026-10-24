import React, { useState } from 'react'
import { Ellipsis } from 'lucide-react'
import { IconButton } from '@terminator/extension-ui'
import { ContextMenu, closeAllContextMenus, type ContextMenuItem } from '../ContextMenu'
import { afterClosing } from '../sidebar/row-events'
import { useDismissedThreads } from './dismissed-threads'
import { leadSessionOf, toggleArchived } from './thread-actions'
import { toggleDone } from './task-actions'
import { openAddToTask } from '../tasks/add-to-task'
import { SESSION_ACTIONS } from '../session/session-actions'
import { SessionLinkDialog } from '../session/SessionLinkDialog'
import { ConfirmDialog } from '../ConfirmDialog'
import { useToastStore } from '../../stores/toast.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import type { WorkThread } from '../../home/work-threads'

export type WorkMenuState = ReturnType<typeof useWorkMenu>

interface InFlightMenuProps {
  thread: WorkThread
  onStartRename: () => void
  workMenu: WorkMenuState
}

interface ItemActions {
  closeMenu: () => void
  onStartRename: () => void
  onLink: () => void
  onRemoveWorktree: () => void
}

/** True when the lead session's project is a git worktree the workspace store can delete. */
function isWorktreeThread(thread: WorkThread): boolean {
  const lead = leadSessionOf(thread)
  if (!lead?.projectId) return false
  const projects = [...useWorkspaceStore.getState().projectsByWorkspaceId.values()].flat()
  return projects.some((p) => p.id === lead.projectId && p.isWorktree)
}

type Run = (fn: () => void) => () => void

/** Session actions: open the terminal, rename the title, link a ticket, or add the branch to a task. */
function sessionItems(thread: WorkThread, run: Run, actions: ItemActions): ContextMenuItem[] {
  const lead = leadSessionOf(thread)
  const items: ContextMenuItem[] = []
  if (lead) {
    items.push({
      label: 'Open terminal',
      onSelect: run(() => SESSION_ACTIONS.onOpen(lead.sessionId)),
    })
  }
  if (lead || thread.taskId !== null) {
    items.push({ label: 'Rename…', onSelect: run(actions.onStartRename) })
  }
  if (lead && thread.ticketKey === undefined) {
    items.push({ label: 'Link ticket…', onSelect: run(actions.onLink) })
  }
  if (thread.lanes.length === 1) {
    const [{ repoRoot, branch }] = thread.lanes
    items.push({ label: 'Add to task…', onSelect: run(() => openAddToTask({ repoRoot, branch })) })
  }
  return items
}

/** Hides the row for good and offers Undo in a toast. */
function dismissWithUndo(thread: WorkThread): void {
  const { dismiss, restore } = useDismissedThreads.getState()
  dismiss(thread.key, Date.now())
  useToastStore.getState().addToast({
    type: 'info',
    message: `Dismissed "${thread.title}"`,
    duration: 6000,
    action: { label: 'Undo', onSelect: () => restore(thread.key) },
  })
}

/** Archive or Restore, and Dismiss: what every row offers. */
function rowItems(thread: WorkThread, run: Run): ContextMenuItem[] {
  const done: ContextMenuItem[] =
    thread.taskId === null
      ? []
      : [
          {
            label: thread.doneAt === null ? 'Mark done' : 'Undo done',
            separatorBefore: true,
            onSelect: run(() => void toggleDone(thread)),
          },
        ]
  return [
    ...done,
    {
      label: thread.archived ? 'Restore' : 'Archive',
      separatorBefore: true,
      onSelect: run(() => toggleArchived(thread)),
    },
    {
      label: 'Dismiss',
      onSelect: run(() => dismissWithUndo(thread)),
    },
  ]
}

/** Close sessions, and Remove worktree for work that has its own folder. */
function endItems(thread: WorkThread, run: Run, actions: ItemActions): ContextMenuItem[] {
  const openSessions = thread.sessions.filter((s) => !s.isClosed)
  const items: ContextMenuItem[] = []
  if (openSessions.length > 0) {
    const closeAll = (): void => openSessions.forEach((s) => SESSION_ACTIONS.onCloseSession?.(s))
    items.push({ label: 'Close sessions', onSelect: run(closeAll) })
  }
  if (leadSessionOf(thread) && isWorktreeThread(thread)) {
    items.push({
      label: 'Remove worktree…',
      separatorBefore: true,
      danger: true,
      onSelect: run(actions.onRemoveWorktree),
    })
  }
  return items
}

/** The menu's items for this thread, each closing the menu before it runs. */
function buildItems(thread: WorkThread, actions: ItemActions): ContextMenuItem[] {
  const run: Run = (fn) => afterClosing(actions.closeMenu, fn)
  return [
    ...sessionItems(thread, run, actions),
    ...rowItems(thread, run),
    ...endItems(thread, run, actions),
  ]
}

interface MenuDialogsProps {
  thread: WorkThread
  linking: boolean
  confirmingRemoval: boolean
  closeLink: () => void
  closeRemoval: () => void
}

/** The link dialog and the worktree-removal confirmation, each open on its own state. */
/** What removing the worktree does; says so when terminals are still open in it. */
function removalDescription(thread: WorkThread): string {
  const open = thread.sessions.filter((s) => !s.isClosed).length
  const base = 'Deletes the folder from disk and the branch card. The branch stays in git.'
  return open === 0
    ? base
    : `${base}\nThis also closes ${open} open ${open === 1 ? 'terminal' : 'terminals'}.`
}

function MenuDialogs({
  thread,
  linking,
  confirmingRemoval,
  closeLink,
  closeRemoval,
}: MenuDialogsProps): JSX.Element {
  const lead = leadSessionOf(thread)
  if (linking && lead) return <SessionLinkDialog facts={lead} onClose={closeLink} />
  if (confirmingRemoval && lead) {
    return (
      <ConfirmDialog
        title={`Remove worktree for "${thread.title}"?`}
        description={removalDescription(thread)}
        confirmLabel="Remove"
        danger
        onConfirm={() => void useWorkspaceStore.getState().deleteProject(lead.projectId ?? '')}
        onClose={closeRemoval}
      />
    )
  }
  return <></>
}

/** Where the row's menu is open, if it is. Opening closes any other menu first. */
export function useWorkMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const openWorkMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    closeAllContextMenus()
    setMenu({ x: e.clientX, y: e.clientY })
  }
  return { menu, openWorkMenu, closeWorkMenu: () => setMenu(null) }
}

/** Which of the menu's two dialogs is open, and the actions that open them. */
function useMenuDialogs() {
  const [linking, setLinking] = useState(false)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  return {
    linking,
    confirmingRemoval,
    openLink: () => setLinking(true),
    openRemoval: () => setConfirmingRemoval(true),
    closeLink: () => setLinking(false),
    closeRemoval: () => setConfirmingRemoval(false),
  }
}

/** The ⋯ button that opens the work menu without opening the drawer. */
function WorkMenuButton({ onOpen }: { onOpen: (e: React.MouseEvent) => void }): JSX.Element {
  return (
    <IconButton
      icon={Ellipsis}
      label="Work actions"
      size="sm"
      className="desk-tr__menu"
      onClick={onOpen}
    />
  )
}

/** The row's ⋯ button and menu, with the link and worktree-removal dialogs. The row opens the
 *  menu on right-click; this layer ignores pointer hits itself, so a left click reaches the row. */
export function InFlightMenu({ thread, onStartRename, workMenu }: InFlightMenuProps): JSX.Element {
  const { menu, openWorkMenu, closeWorkMenu } = workMenu
  const dialogs = useMenuDialogs()
  const items = buildItems(thread, {
    closeMenu: closeWorkMenu,
    onStartRename,
    onLink: dialogs.openLink,
    onRemoveWorktree: dialogs.openRemoval,
  })
  return (
    <span className="desk-tr__controls" onClick={(e) => e.stopPropagation()}>
      <WorkMenuButton onOpen={openWorkMenu} />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onDismiss={closeWorkMenu} />}
      <MenuDialogs thread={thread} {...dialogs} />
    </span>
  )
}
