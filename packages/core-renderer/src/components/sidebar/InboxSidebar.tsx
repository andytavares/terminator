import React, { useEffect, useMemo, useState } from 'react'
import { AlarmClock, Check, ChevronRight, Pin, Plus } from 'lucide-react'
import { IconButton } from '@terminator/extension-ui'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useExtensionRegistry } from '../../extensions/registry'
import { revealSession } from '../../terminal/navigate-to-session'
import { useNow } from '../session/useNow'
import { useWorkThreads } from '../home/useWorkThreads'
import { useDeskSelection } from '../home/desk-selection'
import { useStartWorkStore } from '../home/start-work'
import { leadSessionOf } from '../home/thread-actions'
import { compactAge } from '../home/thread-format'
import { StateGlyph } from '../home/StateGlyph'
import { SnoozeMenu } from '../home/SnoozeMenu'
import { SidebarSearch } from './SidebarSearch'
import { useWorkMarks } from '../../home/work-marks'
import { filterInbox, inboxSections, type InboxFilter } from './inbox'
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
  const { threads, allThreads } = useWorkThreads()
  const clock = useNow(MINUTE_MS)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const repos = useMemo(
    () => workspaces.map((w) => ({ root: w.folderPath, name: w.name })),
    [workspaces]
  )
  const shown = useMemo(() => threads.filter((t) => !t.archived), [threads])
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
  const [filter, setFilter] = useState<InboxFilter>({ text: '', repoRoot: null })
  const marks = useWorkMarks()
  const { cards, settled } = inboxSections(filterInbox(threads, filter), marks, now)
  return (
    <div className="inbox" onKeyDown={moveBetweenCards}>
      <InboxControls filter={filter} onChange={setFilter} repos={repos} />
      <div className="inbox__scroll">
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
        {cards.length === 0 && <div className="inbox__empty">{emptyText(filter)}</div>}
        <SettledSection threads={settled} now={now} />
      </div>
    </div>
  )
}

const emptyText = (filter: InboxFilter): string =>
  filter.text || filter.repoRoot ? 'No work matches' : 'Nothing needs you'

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

/** Shows the thread's most recent session, or its drawer on Home when none is open. */
function openThread(thread: WorkThread): void {
  const lead = leadSessionOf(thread)
  if (lead) return revealSession(lead.sessionId)
  useExtensionRegistry.getState().setActiveGlobalTab('core.home')
  useDeskSelection.getState().openThread(thread.key)
}

interface CardProps {
  thread: WorkThread
  now: number
  pinned: boolean
  settled?: boolean
}

function InboxCard({ thread, now, pinned, settled = false }: CardProps): React.JSX.Element {
  const lane = thread.lanes[0]
  return (
    <li className={`inbox-card${pinned ? ' inbox-card--pinned' : ''}`} aria-label={thread.title}>
      <button
        type="button"
        className="inbox-card__open"
        data-inbox-card
        onClick={() => openThread(thread)}
      >
        <StateGlyph state={thread.state} inferred={thread.inferred} />
        <span className="inbox-card__title">{thread.title}</span>
        <span className="inbox-card__age">
          {pinned && <Pin aria-label="Pinned" />}
          {compactAge(now - thread.lastActivity)}
        </span>
        {lane && <span className="inbox-card__where">{`${lane.repoName} · ${lane.branch}`}</span>}
        {thread.state === 'needs-you' && thread.nowLine && (
          <span className="inbox-card__ask">{thread.nowLine}</span>
        )}
      </button>
      <CardActions thread={thread} now={now} pinned={pinned} settled={settled} />
    </li>
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

function CardActions({ thread, now, pinned, settled }: CardProps): React.JSX.Element {
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
      <SnoozeButton threadKey={thread.key} now={now} />
      {!settled && (
        <IconButton
          size="sm"
          icon={Check}
          label="Settle"
          onClick={() => marks().settle(thread.key, now)}
        />
      )}
    </div>
  )
}

/** "N settled", folded until opened. */
function SettledSection({ threads, now }: { threads: WorkThread[]; now: number }) {
  const [open, setOpen] = useState(false)
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
        {`${threads.length} settled`}
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
