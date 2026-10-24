import React from 'react'
import { CircleCheck, CircleX, Factory, GitBranch } from 'lucide-react'
import { Chip, StatusDot } from '@terminator/extension-ui'
import { compactAge, stateCaption } from './thread-format'
import { useDeskSelection } from './desk-selection'
import { InFlightMenu, useWorkMenu, type WorkMenuState } from './InFlightMenu'
import { SESSION_ACTIONS } from '../session/session-actions'
import { leadSessionOf } from './thread-actions'
import type { WorkThread } from '../../home/work-threads'

interface InFlightRowProps {
  thread: WorkThread
  now: number
  selected: boolean
}

const isOrder = (thread: WorkThread): boolean => thread.facets.some((f) => f.kind === 'order')

/** The mono label before the title: the ticket key, "Order", or the repo. */
function keyLabelOf(thread: WorkThread): string {
  if (thread.ticketKey) return thread.ticketKey
  return isOrder(thread) ? 'Order' : (thread.lanes[0]?.repoName ?? '')
}

interface WorkCellProps {
  thread: WorkThread
  renaming: boolean
  onRename: (text: string) => void
  onCancelRename: () => void
}

function RenameField({
  thread,
  onRename,
  onCancelRename,
}: Omit<WorkCellProps, 'renaming'>): JSX.Element {
  return (
    <input
      className="desk-tr__rename"
      aria-label="Rename work"
      defaultValue={thread.title}
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onRename(e.currentTarget.value)
        if (e.key === 'Escape') onCancelRename()
      }}
    />
  )
}

/** Where the work happens: the order's repo, the branch, or "Scratch terminal". */
function threadPlaceOf(thread: WorkThread): string {
  const [lane] = thread.lanes
  if (isOrder(thread)) return lane?.repoName ?? ''
  return lane?.branch ?? lane?.repoName ?? 'Scratch terminal'
}

/** Where the work happens, with the last thing it said; empty when neither is known. */
function detailLineOf(thread: WorkThread): string {
  return [threadPlaceOf(thread), thread.nowLine].filter((line) => line !== '').join(' · ')
}

function WorkCell({ thread, renaming, onRename, onCancelRename }: WorkCellProps): JSX.Element {
  const detail = detailLineOf(thread)
  return (
    <div className="desk-tr__work">
      <b>
        <span className="desk-sw" style={{ background: thread.lanes[0]?.repoColor ?? undefined }} />
        <span className="desk-tr__key">{keyLabelOf(thread)}</span>
        {renaming ? (
          <RenameField thread={thread} onRename={onRename} onCancelRename={onCancelRename} />
        ) : (
          <span className="desk-tr__title">{thread.title}</span>
        )}
      </b>
      {detail !== '' && (
        <small>
          {isOrder(thread) ? <Factory aria-hidden="true" /> : <GitBranch aria-hidden="true" />}
          {threadPlaceOf(thread)}
          {thread.nowLine !== '' && <span> · </span>}
          <span className="desk-tr__now">{thread.nowLine}</span>
        </small>
      )}
    </div>
  )
}

function AgentsCell({ thread }: { thread: WorkThread }): JSX.Element {
  const live = thread.sessions.filter((s) => s.state === 'working' || s.state === 'awaiting-input')
  return (
    <div className="desk-tr__agents">
      {live.map((s) => (
        <StatusDot
          key={s.sessionId}
          tone={s.state === 'working' ? 'working' : 'waiting'}
          pulse={s.state === 'working'}
        />
      ))}
      {thread.agentsLabel}
    </div>
  )
}

function PullRequestCell({ thread }: { thread: WorkThread }): JSX.Element {
  const chip = thread.prChip
  if (!chip) return <Chip>{isOrder(thread) ? 'none yet' : 'no pull request'}</Chip>
  const icon = { bad: <CircleX aria-hidden="true" />, good: <CircleCheck aria-hidden="true" /> }
  return (
    <Chip tone={chip.tone} icon={icon[chip.tone as 'bad' | 'good']}>
      {chip.text}
    </Chip>
  )
}

/** Saves the typed rename as the lead session's description — the title's last candidate. */
function saveRename(thread: WorkThread, text: string): void {
  const lead = leadSessionOf(thread)
  if (lead) SESSION_ACTIONS.onSaveDescription(lead, text)
}

/** The row's rename mode: on, off without saving, and off saving the typed text. */
function useTitleRename(thread: WorkThread) {
  const [renaming, setRenaming] = React.useState(false)
  return {
    renaming,
    beginTitleRename: () => setRenaming(true),
    cancelTitleRename: () => setRenaming(false),
    finishTitleRename: (text: string) => {
      setRenaming(false)
      saveRename(thread, text)
    },
  }
}

interface RowCellsProps {
  thread: WorkThread
  now: number
  rename: ReturnType<typeof useTitleRename>
  workMenu: WorkMenuState
}

/** The row's cells and its menu: work, state, agents, pull request, age. */
function RowCells({ thread, now, rename, workMenu }: RowCellsProps): JSX.Element {
  return (
    <>
      <WorkCell
        thread={thread}
        renaming={rename.renaming}
        onRename={rename.finishTitleRename}
        onCancelRename={rename.cancelTitleRename}
      />
      <div className="desk-tr__state">{stateCaption(thread, now)}</div>
      <AgentsCell thread={thread} />
      <div>
        <PullRequestCell thread={thread} />
      </div>
      <div className="desk-tr__age">{compactAge(now - thread.lastActivity)}</div>
      <InFlightMenu thread={thread} onStartRename={rename.beginTitleRename} workMenu={workMenu} />
    </>
  )
}

/** One piece of work on the Desk; pressing it, or Enter, opens its drawer. */
export function InFlightRow({ thread, now, selected }: InFlightRowProps): JSX.Element {
  const openThread = useDeskSelection((s) => s.openThread)
  const rename = useTitleRename(thread)
  const workMenu = useWorkMenu()
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={thread.title}
      aria-current={selected || undefined}
      data-thread-key={thread.key}
      className={selected ? 'desk-tr desk-tr--selected' : 'desk-tr'}
      onClick={() => openThread(thread.key)}
      onContextMenu={workMenu.openWorkMenu}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) openThread(thread.key)
      }}
    >
      <RowCells thread={thread} now={now} rename={rename} workMenu={workMenu} />
    </div>
  )
}
