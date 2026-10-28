import { useShallow } from 'zustand/react/shallow'
import React, { useState } from 'react'
import { Play, Circle, Pause, CircleX } from 'lucide-react'
import { useSessionStore } from '../../stores/session.store'
import { useBreakoutStore } from '../../stores/breakout.store'
import { breakOut } from '../../terminal/breakout'
import {
  beginTabDrag,
  isOverTerminatorWindow,
  useTabDragStore,
  type ScreenPoint,
} from '../../terminal/tab-drag'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { AlertBadge } from '../AlertBadge'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu'
import { MoveSessionDialog } from '../sidebar/MoveSessionDialog'
import type { ProjectTabRegistration } from '../../extensions/registry'
import { qualifiedBranchLabel } from '../../sidebar/branch-display'
import { statusPresentationForState, type StatusIcon } from '../../sidebar/session-status'
import { agentStateOf } from '../../sidebar/agent-state'
import './TabBar.css'
import { useSessionFacts } from '../session/useSessionFacts'
import { useSessionRecordsStore } from '../../stores/session-records.store'
import { LaneSwitcher } from './LaneSwitcher'
import { laneOfBranch, openAddToTask } from '../tasks/add-to-task'
import { SessionLinkDialog } from '../session/SessionLinkDialog'
import { DESCRIPTION_MAX_LENGTH } from '../../../shared/session-description'
import { moved } from '../../hooks/useDragReorder'
import type { SessionFacts } from '../../sidebar/session-facts'
import type { TerminalSession } from '../../../shared/types/index'

/**
 * Past this many terminals the row scrolls, and it says so. Overflow being
 * invisible is a defect this feature would otherwise make worse by adding a
 * glyph to every tab (docs/ux-improvement-prd.md 3.4).
 */
const SCROLL_AFTER = 8

/** Same four shapes the sidebar gutter and the board lanes use. */
const STATUS_ICON: Record<StatusIcon, typeof Circle> = {
  play: Play,
  circle: Circle,
  pause: Pause,
  'circle-x': CircleX,
}

interface Props {
  projectId: string
  /**
   * Opens the description editor on this terminal. The ⌘I shortcut points here;
   * the description is the same one Home and the wall show and edit.
   */
  editNoteSessionId?: string | null
  activeProjectTabId: string | null
  projectTabs: ProjectTabRegistration[]
  onSelectProjectTab: (tabId: string | null) => void
  onNewTab: () => void
  onScratchDeactivate?: () => void
}

type FactsById = Map<string, SessionFacts>

/** The ticket key a session is linked to in its own right, or null. */
function ownLinkKey(facts: SessionFacts | undefined): string | null {
  return facts?.workItem?.source === 'session' ? facts.workItem.ref.key : null
}

/** The branch's tabs: roots only (split panes live in their tab), and which one is showing. */
function useBranchTabs(projectId: string) {
  const store = useSessionStore(
    useShallow((s) => ({
      getSessionsForProject: s.getSessionsForProject,
      getActiveSessionForProject: s.getActiveSessionForProject,
      sessions: s.sessions,
      projectViews: s.projectViews,
    }))
  )
  const allSessions = store.getSessionsForProject(projectId)
  const activeSessionId = store.getActiveSessionForProject(projectId)
  const activeSession = allSessions.find((s) => s.id === activeSessionId)
  return {
    allSessions,
    sessions: allSessions.filter((s) => !s.parentSessionId),
    // A split pane shows inside its root's tab, so the root is the one marked active.
    activeId: activeSession?.parentSessionId ?? activeSessionId,
  }
}

/** "repo / branch" for the branch the tabs belong to. */
function useScopeLabel(projectId: string): string | null {
  const { workspaces, projectsByWorkspaceId } = useWorkspaceStore(
    useShallow((s) => ({
      workspaces: s.workspaces,
      projectsByWorkspaceId: s.projectsByWorkspaceId,
    }))
  )
  const branch = [...projectsByWorkspaceId.values()].flat().find((p) => p.id === projectId)
  return branch
    ? qualifiedBranchLabel(branch, workspaces.find((w) => w.id === branch.workspaceId)?.name)
    : null
}

/** The active repo's colour, which tints the tab row. */
function useRepoColor(): string | undefined {
  return useWorkspaceStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.color)
}

/** Saves a tab's description; clearing it saves nothing when there was none. */
function saveDescription(facts: SessionFacts | undefined, text: string): void {
  if (facts === undefined || (text === '' && facts.description === null)) return
  void useSessionRecordsStore.getState().setDescription(facts.snapshot, text === '' ? null : text)
}

/** One tab's inline editor: renaming it, or writing its description. */
function useTabEditing(factsById: FactsById) {
  const [notingId, setNotingId] = useState<string | null>(null)
  const [noteValue, setNoteValue] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const startRename = (sessionId: string, title: string): void => {
    setRenamingId(sessionId)
    setRenameValue(title)
  }
  const commitRename = (sessionId: string): void => {
    const trimmed = renameValue.trim()
    if (trimmed) useSessionStore.getState().renameSession(sessionId, trimmed)
    setRenamingId(null)
  }
  const startNote = (sessionId: string, note: string): void => {
    setNotingId(sessionId)
    setNoteValue(note)
  }
  const commitNote = (sessionId: string): void => {
    setNotingId(null)
    saveDescription(factsById.get(sessionId), noteValue.trim())
  }
  const rename = { id: renamingId, value: renameValue, set: setRenameValue, start: startRename }
  const note = { id: notingId, value: noteValue, set: setNoteValue, start: startNote }
  return {
    rename: { ...rename, commit: commitRename, cancel: () => setRenamingId(null) },
    note: { ...note, commit: commitNote, cancel: () => setNotingId(null) },
  }
}

type TabEditing = ReturnType<typeof useTabEditing>

/** The ⌘I shortcut opens the description editor on the tab it names, once per request, and only
 * for a tab this branch has. */
function useEditNoteRequest(
  editNoteSessionId: string | null | undefined,
  {
    allSessions,
    factsById,
    editing,
  }: { allSessions: TerminalSession[]; factsById: FactsById; editing: TabEditing }
): void {
  const [seenEditNoteSessionId, setSeenEditNoteSessionId] = useState<typeof editNoteSessionId>()
  if (editNoteSessionId !== seenEditNoteSessionId) {
    setSeenEditNoteSessionId(editNoteSessionId)
    if (editNoteSessionId && allSessions.some((s) => s.id === editNoteSessionId)) {
      editing.note.start(editNoteSessionId, factsById.get(editNoteSessionId)?.description ?? '')
    }
  }
}

export function TabBar(props: Props): JSX.Element {
  const { projectId, onNewTab } = props
  const tabs = useBranchTabs(projectId)
  const factsById: FactsById = new Map(useSessionFacts().map((f) => [f.sessionId, f]))
  const editing = useTabEditing(factsById)
  useEditNoteRequest(props.editNoteSessionId, { allSessions: tabs.allSessions, factsById, editing })
  const menus = useTabMenus()
  const wsColor = useRepoColor()

  return (
    <div
      className="tab-bar-stack"
      style={wsColor ? { ['--ws-color' as string]: wsColor } : undefined}
    >
      <LaneSwitcher projectId={projectId} />
      <PrimaryTabs {...props} />
      {props.activeProjectTabId === null && (
        <SessionTabs
          {...{ projectId, tabs, factsById, editing, onNewTab }}
          onContextMenu={menus.openCtxMenu}
        />
      )}
      <TabMenus
        {...{ menus, editing, factsById }}
        sessions={tabs.sessions}
        onScratchDeactivate={props.onScratchDeactivate}
      />
    </div>
  )
}

/** Terminal, then the tabs extensions contribute to a branch. */
function PrimaryTabs({ activeProjectTabId, projectTabs, onSelectProjectTab }: Props): JSX.Element {
  return (
    <div className="tab-bar tab-bar--primary">
      <div
        className={`tab-bar__tab${activeProjectTabId === null ? ' tab-bar__tab--active' : ''}`}
        onClick={() => onSelectProjectTab(null)}
      >
        <span className="tab-bar__title">Terminal</span>
      </div>

      {projectTabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-bar__tab${tab.id === activeProjectTabId ? ' tab-bar__tab--active' : ''}`}
          onClick={() => onSelectProjectTab(tab.id)}
        >
          <span className="tab-bar__title">{tab.label}</span>
        </div>
      ))}
    </div>
  )
}

interface SessionTabsProps {
  projectId: string
  tabs: ReturnType<typeof useBranchTabs>
  factsById: FactsById
  editing: TabEditing
  onContextMenu: (e: React.MouseEvent, sessionId: string) => void
  onNewTab: () => void
}

/** The saved order after the drawn tabs were rearranged: every tab that is not drawn keeps the
 * place it had. */
function orderKeepingHidden(all: TerminalSession[], reorderedDrawn: TerminalSession[]): string[] {
  const drawnIds = new Set(reorderedDrawn.map((s) => s.id))
  const remaining = [...reorderedDrawn]
  return all.map((s) => (drawnIds.has(s.id) ? remaining.shift()! : s).id)
}

/** A tab let go over another tab takes its place; let go over no Terminator window, it opens in
 * a window of its own there. */
function dropSessionTab(projectId: string, all: TerminalSession[], drawn: TerminalSession[]) {
  return (sessionId: string) =>
    (point: ScreenPoint, overSessionId: string | null): void => {
      if (overSessionId === null) {
        if (!isOverTerminatorWindow(point)) breakOut(sessionId, point)
        return
      }
      const from = drawn.findIndex((s) => s.id === sessionId)
      const to = drawn.findIndex((s) => s.id === overSessionId)
      if (from === -1 || to === -1 || from === to) return
      const order = orderKeepingHidden(all, moved(drawn, from, to))
      useSessionStore.getState().reorderSessions(projectId, order)
    }
}

/** The branch's terminals, in their order, which a drag rearranges. One in its own window has no
 * tab here, and gets its place back when it docks. */
function SessionTabs(props: SessionTabsProps): JSX.Element {
  const windows = useBreakoutStore((s) => s.windows)
  const all = props.tabs.sessions
  const sessions = all.filter((s) => !windows.has(s.id))
  const dropOf = dropSessionTab(props.projectId, all, sessions)
  return (
    <div
      className={`tab-bar tab-bar--sessions${sessions.length > SCROLL_AFTER ? ' tab-bar--scrollable' : ''}`}
    >
      <ScopeLabel projectId={props.projectId} />
      {sessions.map((session) => (
        <SessionTab key={session.id} {...props} session={session} onDrop={dropOf(session.id)} />
      ))}
      <button className="tab-bar__new-tab" onClick={props.onNewTab} title="New tab (⌘T)">
        +
      </button>
    </div>
  )
}

/** Tabs are scoped to one branch, and switching branches silently swapped the whole row. Say
 * whose terminals these are. */
function ScopeLabel({ projectId }: { projectId: string }): JSX.Element | null {
  const scopeLabel = useScopeLabel(projectId)
  if (!scopeLabel) return null
  return (
    <span className="tab-bar__scope" title={scopeLabel}>
      {scopeLabel}
    </span>
  )
}

interface SessionTabProps extends SessionTabsProps {
  session: TerminalSession
  onDrop: (point: ScreenPoint, overSessionId: string | null) => void
}

/** The tab's class: active, being dragged, or the one a dragged tab would land on. */
function useSessionTabClass(sessionId: string, isActive: boolean): string {
  const dragged = useTabDragStore((s) => s.sessionId === sessionId)
  const landing = useTabDragStore((s) => s.overSessionId === sessionId && s.sessionId !== sessionId)
  return `tab-bar__tab tab-bar__tab--session${isActive ? ' tab-bar__tab--active' : ''}${dragged ? ' tab-bar__tab--dragging' : ''}${landing ? ' tab-bar__tab--dnd-over' : ''}`
}

function SessionTab(props: SessionTabProps): JSX.Element {
  const { projectId, session, editing } = props
  const isActive = session.id === props.tabs.activeId
  const isRenaming = editing.rename.id === session.id
  const showSession = (): void => {
    useSessionStore.getState().setActiveSessionForProject(projectId, session.id)
    useSessionStore.getState().requestFocus(session.id)
  }
  return (
    <div
      data-session-tab={session.id}
      onPointerDown={(e) => !isRenaming && beginTabDrag(e, session.id, props.onDrop)}
      className={useSessionTabClass(session.id, isActive)}
      onClick={showSession}
      onContextMenu={(e) => props.onContextMenu(e, session.id)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        editing.rename.start(session.id, session.tabTitle)
      }}
      /* The description is drawn nowhere on the tab: a fifth thing on a
         100px tab makes it unreadable. The rename affordance sits on the
         same element, so without one the tooltip says what
         double-clicking the tab actually does. */
      title={props.factsById.get(session.id)?.description ?? 'Double-click to rename'}
    >
      {!isRenaming && <TabStateIcon session={session} />}
      <TabLabel {...props} />
      {!isRenaming && <TabEnd sessionId={session.id} isActive={isActive} />}
    </div>
  )
}

export function TabStateIcon({ session }: { session: TerminalSession }): JSX.Element {
  const state = agentStateOf(session)
  const status = statusPresentationForState(state)
  const Icon = STATUS_ICON[status.icon]
  return (
    <span className="tab-bar__state" aria-label={status.label}>
      <Icon aria-hidden="true" data-state={state} />
    </span>
  )
}

/** The tab's name and its own ticket key, or the editor open on it. */
function TabLabel({ session, editing, factsById }: SessionTabProps): JSX.Element {
  if (editing.note.id === session.id) {
    return <NoteInput sessionId={session.id} note={editing.note} />
  }
  if (editing.rename.id === session.id) {
    return <RenameInput sessionId={session.id} rename={editing.rename} />
  }
  const key = ownLinkKey(factsById.get(session.id))
  return (
    <>
      <span className="tab-bar__title">{session.tabTitle}</span>
      {key !== null && <span className="tab-bar__key">{key}</span>}
    </>
  )
}

function NoteInput({ sessionId, note }: { sessionId: string; note: TabEditing['note'] }) {
  return (
    <input
      className="tmui-inline-edit tab-bar__note-input"
      value={note.value}
      maxLength={DESCRIPTION_MAX_LENGTH}
      placeholder="What is this session doing?"
      autoFocus
      onChange={(e) => note.set(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') note.commit(sessionId)
        if (e.key === 'Escape') note.cancel()
      }}
      onBlur={() => note.commit(sessionId)}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

function RenameInput({ sessionId, rename }: { sessionId: string; rename: TabEditing['rename'] }) {
  return (
    <input
      className="tab-bar__rename-input"
      value={rename.value}
      onChange={(e) => rename.set(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') rename.commit(sessionId)
        if (e.key === 'Escape') rename.cancel()
        e.stopPropagation()
      }}
      onBlur={() => rename.commit(sessionId)}
      onClick={(e) => e.stopPropagation()}
      autoFocus
    />
  )
}

/** The bell count on a tab you are not on; the close button on the one you are. A close button
 * on every tab was the fourth element on a 100px box, and closing a terminal you are not
 * looking at is not a thing worth one-clicking. */
function TabEnd({ sessionId, isActive }: { sessionId: string; isActive: boolean }) {
  const bells = useSessionStore((s) => s.getBellCountForSession(sessionId))
  if (!isActive) return <AlertBadge count={bells} className="alert-badge--tab" />
  return (
    <button
      className="tab-bar__close"
      onClick={(e) => {
        e.stopPropagation()
        void useSessionStore.getState().closeSession(sessionId)
      }}
      title="Close tab"
    >
      ×
    </button>
  )
}

/** The tab's context menu and the dialogs it opens: move to a branch, link an issue. */
function useTabMenus() {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)
  const [moveDialogSessionId, setMoveDialogSessionId] = useState<string | null>(null)
  const [linkSessionId, setLinkSessionId] = useState<string | null>(null)
  const openCtxMenu = (e: React.MouseEvent, sessionId: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, sessionId })
  }
  return {
    ...{ ctxMenu, setCtxMenu, openCtxMenu },
    ...{ moveDialogSessionId, setMoveDialogSessionId, linkSessionId, setLinkSessionId },
  }
}

interface TabMenusProps {
  menus: ReturnType<typeof useTabMenus>
  editing: TabEditing
  factsById: FactsById
  sessions: TerminalSession[]
  onScratchDeactivate?: () => void
}

function TabMenus({ menus, factsById, onScratchDeactivate, ...rest }: TabMenusProps) {
  const linkFacts = menus.linkSessionId === null ? undefined : factsById.get(menus.linkSessionId)
  return (
    <>
      {menus.ctxMenu && <TabCtxMenu {...rest} {...{ menus, factsById }} />}
      {menus.moveDialogSessionId && (
        <MoveSessionDialog
          sessionId={menus.moveDialogSessionId}
          onClose={() => menus.setMoveDialogSessionId(null)}
          onMoved={() => {
            menus.setMoveDialogSessionId(null)
            onScratchDeactivate?.()
          }}
        />
      )}
      {linkFacts && (
        <SessionLinkDialog facts={linkFacts} onClose={() => menus.setLinkSessionId(null)} />
      )}
    </>
  )
}

/** The context menu for the tab it was opened on; each choice closes it first. */
function TabCtxMenu({ menus, editing, factsById, sessions }: TabMenusProps): JSX.Element {
  const { x, y, sessionId } = menus.ctxMenu!
  const close = () => menus.setCtxMenu(null)
  const then = (act: () => void) => () => {
    close()
    act()
  }
  const facts = factsById.get(sessionId)
  const session = sessions.find((s) => s.id === sessionId)
  const items = tabMenuItems({ sessionId, session, facts, menus, editing, then })
  return <ContextMenu {...{ x, y, items }} onDismiss={close} />
}

interface TabMenuItemsInput extends IssueItemsInput {
  session: TerminalSession | undefined
  editing: TabEditing
}

function tabMenuItems(input: TabMenuItemsInput): ContextMenuItem[] {
  const { sessionId, session, facts, menus, editing, then } = input
  return [
    {
      label: 'Rename',
      onSelect: then(() => editing.rename.start(sessionId, session?.tabTitle ?? '')),
    },
    {
      label: facts?.description ? 'Edit description…' : 'Add description…',
      onSelect: then(() => editing.note.start(sessionId, facts?.description ?? '')),
    },
    {
      label: 'Move to branch…',
      separatorBefore: true,
      onSelect: then(() => menus.setMoveDialogSessionId(sessionId)),
    },
    { label: 'Add to task…', onSelect: then(() => addBranchToTask(session)) },
    ...issueItems(input),
    closeItem(sessionId, then),
  ]
}

function closeItem(sessionId: string, then: IssueItemsInput['then']): ContextMenuItem {
  return {
    label: 'Close tab',
    danger: true,
    separatorBefore: true,
    onSelect: then(() => void useSessionStore.getState().closeSession(sessionId)),
  }
}

interface IssueItemsInput {
  facts: SessionFacts | undefined
  sessionId: string
  menus: ReturnType<typeof useTabMenus>
  then: (act: () => void) => () => void
}

/** Link or change the session's ticket, and remove the link when it has one. */
function issueItems(input: IssueItemsInput): ContextMenuItem[] {
  const { facts, sessionId, menus, then } = input
  const hasLink = ownLinkKey(facts) !== null
  const link: ContextMenuItem = {
    label: hasLink ? 'Change linked issue…' : 'Link issue…',
    separatorBefore: true,
    onSelect: then(() => menus.setLinkSessionId(sessionId)),
  }
  if (!hasLink) return [link]
  const remove: ContextMenuItem = {
    label: 'Remove session link',
    danger: true,
    onSelect: then(
      () => facts && void useSessionRecordsStore.getState().setLink(facts.snapshot, null)
    ),
  }
  return [link, remove]
}

/** Opens the Add to task picker for the branch a tab's terminal is on. */
function addBranchToTask(session: TerminalSession | undefined): void {
  const lane = laneOfBranch(session?.projectId)
  if (lane) openAddToTask(lane)
}
