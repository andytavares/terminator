import React, { useEffect, useMemo, useState } from 'react'
import { AlarmClock, Check, ChevronRight, Paperclip, Pin, Plus, RotateCcw } from 'lucide-react'
import { IconButton } from '@terminator/extension-ui'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionStore } from '../../stores/session.store'
import { attachSessions } from '../../stores/attached-context.store'
import { useExtensionRegistry } from '../../extensions/registry'
import { revealSession } from '../../terminal/navigate-to-session'
import { useNow } from '../session/useNow'
import { useWorkThreads } from '../home/useWorkThreads'
import { useDeskSelection } from '../home/desk-selection'
import { useStartWorkStore } from '../home/start-work'
import { leadSessionOf } from '../home/thread-actions'
import { openInExtension, untilLabel } from '../home/desk-actions'
import { useOpenInApp } from '../home/open-in-app'
import { compactAge } from '../home/thread-format'
import { StateGlyph } from '../home/StateGlyph'
import { SnoozeMenu } from '../home/SnoozeMenu'
import { settleWithUndo } from '../home/InFlightMenu'
import { carryThread, useDraggedThread } from '../home/thread-drag'
import { SidebarSearch } from './SidebarSearch'
import { useWorkMarks } from '../../home/work-marks'
import {
  asksHiddenByRepo,
  filterInbox,
  inboxSections,
  useInboxFilter,
  type InboxFilter,
} from './inbox'
import type { WorkThread } from '../../home/work-threads'
import './InboxSidebar.css'

const MINUTE_MS = 60_000
const CARD = '[data-inbox-card]'

interface Repo {
  root: string
  name: string
}

/** The Inbox sidebar: Home's work threads as cards, joined from the live stores. */
export function InboxSidebar({ now }: { now?: number }): React.JSX.Element {
  const { threads, settledThreads, allThreads } = useWorkThreads()
  const clock = useNow(MINUTE_MS)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const repos = useMemo(
    () => workspaces.map((w) => ({ root: w.folderPath, name: w.name })),
    [workspaces]
  )
  // The Inbox draws its own settled section, so it takes the settled threads back.
  const shown = useMemo(
    () => [...threads, ...settledThreads].filter((t) => !t.archived),
    [threads, settledThreads]
  )
  useEffect(() => {
    useWorkMarks.getState().forgetGone(new Set(allThreads.map((t) => t.key)), Date.now())
  }, [allThreads])
  return <InboxList threads={shown} now={now ?? clock} repos={repos} />
}

interface InboxListProps {
  threads: readonly WorkThread[]
  now: number
  repos: readonly Repo[]
}

/** Search and the repo filter, the cards, then the settled section.
 * @internal */
export function InboxList({ threads, now, repos }: InboxListProps): React.JSX.Element {
  const { filter, setFilter } = useInboxFilter()
  const marks = useWorkMarks()
  const { cards, settled } = inboxSections(filterInbox(threads, filter), marks, now)
  return (
    <div className="inbox" onKeyDown={moveBetweenCards}>
      <InboxControls filter={filter} onChange={setFilter} repos={repos} />
      <div className="inbox__scroll">
        <HiddenAsksLine threads={threads} />
        <ul className="inbox__cards" aria-label="Inbox">
          {cards.map((thread) => (
            <InboxCard
              key={thread.key}
              thread={thread}
              now={now}
              pinned={thread.key in marks.pinned}
            />
          ))}
        </ul>
        {cards.length === 0 && (
          <div className="inbox__empty">{emptyText(filter, settled.length > 0)}</div>
        )}
        <SettledSection threads={settled} now={now} searching={filter.text !== ''} />
      </div>
    </div>
  )
}

function emptyText(filter: InboxFilter, settledMatch: boolean): string {
  if (!filter.text && !filter.repoRoot) return 'Nothing needs you'
  return settledMatch ? 'No active work matches' : 'No work matches'
}

/** "2 needs you in web", over the cards, when the repo filter hides asks. */
function HiddenAsksLine({ threads }: { threads: readonly WorkThread[] }) {
  const { filter, setFilter } = useInboxFilter()
  const { count, repoNames } = asksHiddenByRepo(threads, filter)
  if (count === 0) return null
  const where = repoNames.length === 1 ? repoNames[0] : 'other repos'
  return (
    <div className="inbox__hidden-asks">
      <span>{`${count} needs you in ${where}`}</span>
      <button
        type="button"
        className="inbox__show"
        onClick={() => setFilter({ ...filter, repoRoot: null })}
      >
        Show
      </button>
    </div>
  )
}

/** Arrow keys move between cards, and from the search field onto the first one. Keys from
 * anything else (the Repo select, a Snooze menu) are theirs. */
function moveBetweenCards(event: React.KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const from = event.target as HTMLElement
  if (!from.matches(`${CARD}, input[type="search"], input[aria-label="Search"]`)) return
  const cards = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(CARD))
  const at = cards.indexOf(document.activeElement as HTMLElement)
  const next = event.key === 'ArrowDown' ? at + 1 : at - 1
  if (cards.length === 0 || (at < 0 && event.key === 'ArrowUp')) return
  event.preventDefault()
  cards[Math.min(Math.max(next, 0), cards.length - 1)].focus()
}

interface ControlsProps {
  filter: InboxFilter
  onChange: (filter: InboxFilter) => void
  repos: readonly Repo[]
}

function InboxControls({ filter, onChange, repos }: ControlsProps): React.JSX.Element {
  return (
    <div className="inbox__controls">
      <SidebarSearch
        query={filter.text}
        onChange={(text) => onChange({ ...filter, text })}
        onClear={() => onChange({ ...filter, text: '' })}
      />
      <select
        aria-label="Repo"
        className="inbox__repo"
        value={filter.repoRoot ?? ''}
        onChange={(e) => onChange({ ...filter, repoRoot: e.target.value || null })}
      >
        <option value="">All repos</option>
        {repos.map((repo) => (
          <option key={repo.root} value={repo.root}>
            {repo.name}
          </option>
        ))}
      </select>
      <IconButton
        icon={Plus}
        label="Start work"
        description="Start work (⌘N)"
        onClick={() => useStartWorkStore.getState().openLauncher()}
      />
    </div>
  )
}

/** Shows the thread's most recent session, else its extension's view, else its drawer on Home. */
function openThread(thread: WorkThread): void {
  const lead = leadSessionOf(thread)
  if (lead) return revealSession(lead.sessionId)
  if (thread.opensIn !== null) return void openInExtension(thread.opensIn.source, thread.opensIn)
  useExtensionRegistry.getState().setActiveGlobalTab('core.home')
  useDeskSelection.getState().openThread(thread.key)
}

interface CardProps {
  thread: WorkThread
  now: number
  pinned: boolean
  settled?: boolean
}

const hasSessions = (thread: WorkThread): boolean =>
  thread.lanes.some((lane) => lane.sessionIds.length > 0)

function cardClass(pinned: boolean, held: boolean): string {
  return `inbox-card${pinned ? ' inbox-card--pinned' : ''}${held ? ' inbox-card--dragging' : ''}`
}

/** The repo and branch, or only the repo when the branch is already the title. */
function whereOf(thread: WorkThread): string | null {
  const lane = thread.lanes[0]
  if (!lane) return null
  return lane.branch === thread.title ? lane.repoName : `${lane.repoName} · ${lane.branch}`
}

function InboxCard({ thread, now, pinned, settled = false }: CardProps): React.JSX.Element {
  const held = useDraggedThread((s) => s.thread?.key === thread.key)
  const where = whereOf(thread)
  return (
    <li className={cardClass(pinned, held)} aria-label={thread.title}>
      <button
        type="button"
        className="inbox-card__open"
        data-inbox-card
        title={thread.title}
        draggable={hasSessions(thread)}
        onDragStart={(event) => carryThread(event, thread)}
        onDragEnd={() => useDraggedThread.setState({ thread: null })}
        onClick={() => openThread(thread)}
      >
        <StateGlyph state={thread.state} inferred={thread.inferred} />
        <span className="inbox-card__title">{thread.title}</span>
        {where && <span className="inbox-card__where">{where}</span>}
        {thread.state === 'needs-you' && thread.nowLine && (
          <span className="inbox-card__ask">{thread.nowLine}</span>
        )}
      </button>
      <div className="inbox-card__end">
        <CardAge thread={thread} now={now} pinned={pinned} />
        <CardActions thread={thread} now={now} pinned={pinned} settled={settled} />
      </div>
    </li>
  )
}

/** How long ago the work moved, or when a snooze ends. */
function CardAge({ thread, now, pinned }: Omit<CardProps, 'settled'>): React.JSX.Element {
  const until = useWorkMarks((s) => s.snoozed[thread.key])
  const snoozed = until !== undefined && until > now
  return (
    <span className="inbox-card__age">
      {pinned && <Pin aria-label="Pinned" />}
      {snoozed && <AlarmClock aria-label="Snoozed until" />}
      {snoozed ? untilLabel(until) : compactAge(now - thread.lastActivity)}
    </span>
  )
}

function SnoozeButton({ threadKey, now }: { threadKey: string; now: number }) {
  const [snoozing, setSnoozing] = useState(false)
  return (
    <span className="inbox-card__snooze">
      <IconButton size="sm" icon={AlarmClock} label="Snooze" onClick={() => setSnoozing(true)} />
      {snoozing && (
        <SnoozeMenu
          now={now}
          onPick={(until) => {
            setSnoozing(false)
            useWorkMarks.getState().snooze(threadKey, until)
          }}
          onClose={() => setSnoozing(false)}
        />
      )}
    </span>
  )
}

function OpenInAppButton({ thread }: { thread: WorkThread }): React.JSX.Element | null {
  const openInApp = useOpenInApp(thread)
  if (!openInApp) return null
  return (
    <IconButton size="sm" icon={openInApp.icon} label={openInApp.label} onClick={openInApp.open} />
  )
}

/** The agent tab on screen in the active project, or null when it shows a terminal. */
function useShownAgentTab() {
  const projectId = useWorkspaceStore((s) => s.activeProjectId)
  const tabId = useSessionStore((s) => (projectId ? s.getActiveSessionForProject(projectId) : null))
  const session = useSessionStore((s) => (tabId ? s.sessions.get(tabId) : undefined))
  return session?.surface === 'agent' ? session : null
}

function AttachButton({ thread }: { thread: WorkThread }): React.JSX.Element | null {
  const tab = useShownAgentTab()
  if (!tab || !hasSessions(thread)) return null
  const sessionIds = thread.lanes.flatMap((lane) => lane.sessionIds)
  return (
    <IconButton
      size="sm"
      icon={Paperclip}
      label={`Attach to ${tab.tabTitle}`}
      onClick={() => void attachSessions(tab.id, sessionIds)}
    />
  )
}

/** A thread settled by a quiet day has no mark to clear, so only marked ones offer Restore. */
function SettleOrRestore({ thread, settled }: { thread: WorkThread; settled: boolean }) {
  const marked = useWorkMarks((s) => thread.key in s.settled || thread.key in s.snoozed)
  if (settled) {
    if (!marked) return null
    return (
      <IconButton
        size="sm"
        icon={RotateCcw}
        label="Restore"
        onClick={() => useWorkMarks.getState().restore(thread.key)}
      />
    )
  }
  return <IconButton size="sm" icon={Check} label="Settle" onClick={() => settleWithUndo(thread)} />
}

function CardActions({ thread, now, pinned, settled = false }: CardProps): React.JSX.Element {
  const marks = useWorkMarks.getState
  return (
    <div className="inbox-card__actions">
      <IconButton
        size="sm"
        icon={Pin}
        label={pinned ? 'Unpin' : 'Pin'}
        pressed={pinned}
        onClick={() => marks().togglePin(thread.key, now)}
      />
      <AttachButton thread={thread} />
      <OpenInAppButton thread={thread} />
      <SnoozeButton threadKey={thread.key} now={now} />
      <SettleOrRestore thread={thread} settled={settled} />
    </div>
  )
}

interface SettledProps {
  threads: WorkThread[]
  now: number
  searching: boolean
}

function settledLabel(count: number, searching: boolean): string {
  if (!searching) return `${count} settled`
  return `${count} settled ${count === 1 ? 'match' : 'matches'}`
}

/** "N settled", folded until opened; open while searching, so its matches show. */
function SettledSection({ threads, now, searching }: SettledProps) {
  const [opened, setOpen] = useState(false)
  const open = opened || searching
  if (threads.length === 0) return null
  return (
    <section className="inbox__settled">
      <button
        type="button"
        className="inbox__settled-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight aria-hidden="true" className={open ? 'inbox__chevron--open' : undefined} />
        {settledLabel(threads.length, searching)}
      </button>
      {open && (
        <ul className="inbox__cards" aria-label="Settled">
          {threads.map((thread) => (
            <InboxCard key={thread.key} thread={thread} now={now} pinned={false} settled />
          ))}
        </ul>
      )}
    </section>
  )
}
