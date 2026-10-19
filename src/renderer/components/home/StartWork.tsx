import React, { useState } from 'react'
import { Bot, GitBranch, Plus } from 'lucide-react'
import { Button, Chip, Kbd, ModalShell } from '@terminator/extension-ui'
import { startScratchSession } from '../../terminal/start-session'
import { useWorkspaceStore } from '../../stores/workspace.store'
import {
  branchOf,
  cycleRunAs,
  startWork,
  useRunAsOptions,
  useStartWorkStore,
  worktreeFolder,
  type RunAs,
  type WorkRequest,
} from './start-work'
import {
  NO_GIT,
  useChosenRepo,
  useMyTickets,
  useRepoGit,
  useRows,
  type LauncherRow,
  type LauncherTab,
} from './start-work-model'
import type { TicketGroup } from './start-work'
import type { IssueSummary, Workspace } from '../../../shared/types/index'
import './StartWork.css'

const TABS: Array<{ id: LauncherTab; label: string }> = [
  { id: 'tickets', label: 'My tickets' },
  { id: 'prompt', label: 'Prompt' },
  { id: 'branch', label: 'Branch' },
  { id: 'scratch', label: 'Scratch terminal' },
]

/** Mounts the launcher while ⌘N, Quick actions or the Home button has it open. */
export function StartWorkHost(): JSX.Element | null {
  const { open, closeLauncher } = useStartWorkStore()
  return open ? <StartWork onClose={closeLauncher} /> : null
}

/** What the person has typed, picked and been told so far. */
function useLauncherFields() {
  const prefill = useStartWorkStore.getState().prefill
  const [tab, setTab] = useState<LauncherTab>('tickets')
  const [query, setQuery] = useState(prefill)
  const [runAs, setRunAs] = useState<RunAs>('agent')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [pickedRepoId, setPickedRepoId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return {
    ...{ tab, query, runAs, selectedIndex, pickedRepoId, picking, error },
    ...{ setTab, setQuery, setRunAs, setSelectedIndex, setPickedRepoId, setPicking, setError },
  }
}

type Fields = ReturnType<typeof useLauncherFields>

/** The lists, the selected row and the repo, which depend on one another in that order. */
function useLauncherData(fields: Fields) {
  const { tab, query, selectedIndex, pickedRepoId } = fields
  const issues = useMyTickets()
  const ticketRows = useRows({ tab, query, issues, git: NO_GIT }).rows
  const repo = useChosenRepo(ticketRows[selectedIndex], pickedRepoId)
  const git = useRepoGit(repo)
  const { groups, rows } = useRows({ tab, query, issues, git })
  const index = Math.max(0, Math.min(selectedIndex, rows.length - 1))
  return { repo, git, groups, rows, selected: rows[index] as LauncherRow | undefined, index }
}

function useLauncher(onClose: () => void) {
  const fields = useLauncherFields()
  const data = useLauncherData(fields)
  const { tab, query, runAs, picking, error } = fields
  const runAsOptions = useRunAsOptions()
  const view = { tab, query, runAs, picking, error, runAsOptions, ...data }
  const actions = launcherActions({ fields, view, onClose })
  return { view, actions, selectedIndex: data.index }
}

interface ActionsInput {
  fields: Fields
  view: {
    tab: LauncherTab
    query: string
    runAs: RunAs
    selected?: LauncherRow
    repo: Workspace | null
  }
  onClose: () => void
}

function launcherActions({ fields, view, onClose }: ActionsInput) {
  const fresh = (): void => (fields.setSelectedIndex(0), fields.setError(null))
  return {
    setTab: (next: LauncherTab) => {
      fields.setTab(next)
      fresh()
    },
    typeQuery: (next: string) => {
      fields.setQuery(next)
      fresh()
    },
    setRunAs: fields.setRunAs,
    select: fields.setSelectedIndex,
    pickRepo: (id: string) => {
      fields.setPickedRepoId(id)
      fields.setPicking(false)
    },
    togglePicker: () => fields.setPicking(!fields.picking),
    start: () => submit({ view, onClose, setError: fields.setError }),
    dismiss: () => (fields.picking ? fields.setPicking(false) : onClose()),
  }
}

type Launcher = ReturnType<typeof useLauncher>

interface SubmitInput {
  view: ActionsInput['view']
  onClose: () => void
  setError: (message: string | null) => void
}

function requestFor(view: ActionsInput['view'], repo: Workspace): WorkRequest | null {
  const { selected, runAs, tab, query } = view
  if (tab === 'prompt' || selected?.kind === 'prompt') {
    return query.trim() === '' ? null : { kind: 'prompt', text: query, workspace: repo, runAs }
  }
  if (selected?.kind === 'ticket')
    return { kind: 'ticket', issue: selected.issue, workspace: repo, runAs }
  if (selected?.kind === 'branch')
    return { kind: 'branch', branch: selected.name, workspace: repo, runAs }
  return null
}

async function submit({ view, onClose, setError }: SubmitInput): Promise<void> {
  if (view.tab === 'scratch') {
    onClose()
    return void startScratchSession()
  }
  if (view.repo === null) return setError('Add a repo in the sidebar first.')
  const request = requestFor(view, view.repo)
  if (request === null) return
  const message = await startWork(request)
  if (message === null) onClose()
  else setError(message)
}

/** The launcher: pick a ticket, a prompt or a branch, choose how to run it, press Enter. */
export function StartWork({ onClose }: { onClose: () => void }): JSX.Element {
  const launcher = useLauncher(onClose)
  const { view, actions } = launcher
  return (
    <ModalShell label="Start work" placement="top" onDismiss={actions.dismiss}>
      <div className="start-work" onKeyDown={(e) => handleKey(e, launcher)}>
        <SearchRow {...{ view, actions }} />
        <TabRow {...{ view, actions }} />
        <div className="start-work__body">
          <ChoiceList {...launcher} />
          <RunAsPanel {...launcher} />
        </div>
        <Footer {...launcher} />
      </div>
    </ModalShell>
  )
}

function handleKey(e: React.KeyboardEvent, { view, actions, selectedIndex }: Launcher): void {
  const moves: Record<string, () => void> = {
    ArrowDown: () => actions.select(Math.min(selectedIndex + 1, view.rows.length - 1)),
    ArrowUp: () => actions.select(Math.max(selectedIndex - 1, 0)),
    Tab: () => actions.setRunAs(cycleRunAs(view.runAsOptions, view.runAs, e.shiftKey ? -1 : 1)),
    Enter: () => void actions.start(),
  }
  const isRepoKey = e.key.toLowerCase() === 'r' && (e.metaKey || e.ctrlKey)
  const run = isRepoKey ? actions.togglePicker : moves[e.key]
  if (run === undefined) return
  e.preventDefault()
  run()
}

type PartProps = Pick<Launcher, 'view' | 'actions'>

const PLACEHOLDERS: Record<LauncherTab, string> = {
  tickets: 'Search tickets, or type a prompt',
  prompt: 'Describe the task',
  branch: 'Search branches',
  scratch: 'Nothing to type for a scratch terminal',
}

function SearchRow({ view, actions }: PartProps): JSX.Element {
  return (
    <div className="start-work__input">
      <Plus aria-hidden="true" />
      <input
        autoFocus
        value={view.query}
        placeholder={PLACEHOLDERS[view.tab]}
        aria-label="Search tickets or type a prompt"
        disabled={view.tab === 'scratch'}
        onChange={(e) => actions.typeQuery(e.target.value)}
      />
      <Kbd>Esc</Kbd>
    </div>
  )
}

function TabRow({ view, actions }: PartProps): JSX.Element {
  return (
    <div className="start-work__tabs" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          tabIndex={-1}
          aria-selected={view.tab === tab.id}
          onClick={() => actions.setTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

const HINTS: Partial<Record<LauncherTab, string>> = {
  prompt: 'Type the task above. Enter starts it.',
  scratch: 'A terminal that belongs to no branch. Enter opens it.',
}

function ChoiceList({ view, actions, selectedIndex }: Launcher): JSX.Element {
  const hint = HINTS[view.tab]
  return (
    <div className="start-work__list" role="listbox" aria-label="Choices">
      {hint !== undefined && <p className="start-work__hint">{hint}</p>}
      {view.tab === 'tickets' && <TicketRows {...{ view, actions, selectedIndex }} />}
      {view.tab === 'branch' && <BranchRows {...{ view, actions, selectedIndex }} />}
    </div>
  )
}

function TicketRows({ view, actions, selectedIndex }: Launcher): JSX.Element {
  const typed = view.query.trim()
  const promptIndex = rowsBefore(view.groups, view.groups.length)
  return (
    <>
      {view.groups.map((group, g) => (
        <React.Fragment key={group.label}>
          <h3 className="start-work__group">{group.label}</h3>
          {group.issues.map((issue, i) => (
            <TicketRow
              key={issue.id}
              issue={issue}
              selected={rowsBefore(view.groups, g) + i === selectedIndex}
              onSelect={() => actions.select(rowsBefore(view.groups, g) + i)}
            />
          ))}
        </React.Fragment>
      ))}
      {typed !== '' && (
        <PromptRow
          text={typed}
          selected={promptIndex === selectedIndex}
          onSelect={() => actions.select(promptIndex)}
        />
      )}
    </>
  )
}

/** How many rows sit above group number `groupIndex`. */
const rowsBefore = (groups: TicketGroup[], groupIndex: number): number =>
  groups.slice(0, groupIndex).reduce((total, group) => total + group.issues.length, 0)

interface TicketRowProps {
  issue: IssueSummary
  selected: boolean
  onSelect: () => void
}

function TicketRow({ issue, selected, onSelect }: TicketRowProps): JSX.Element {
  return (
    <div role="option" aria-selected={selected} className="start-work__row" onClick={onSelect}>
      <span aria-hidden="true" />
      <span className="start-work__key" data-testid="start-work-key">
        {issue.key}
      </span>
      <span>{issue.title}</span>
      <Chip>{issue.state.name}</Chip>
    </div>
  )
}

interface PromptRowProps {
  text: string
  selected: boolean
  onSelect: () => void
}

function PromptRow({ text, selected, onSelect }: PromptRowProps): JSX.Element {
  return (
    <>
      <h3 className="start-work__group">Or start from what you typed</h3>
      <div role="option" aria-selected={selected} className="start-work__row" onClick={onSelect}>
        <Bot aria-hidden="true" />
        <span className="start-work__key">Prompt</span>
        <span>"{text}" as a new agent task, no ticket</span>
        <span />
      </div>
    </>
  )
}

function BranchRows({ view, actions, selectedIndex }: Launcher): JSX.Element {
  return (
    <>
      {view.rows.map((row, i) => (
        <div
          key={row.kind === 'branch' ? row.name : i}
          role="option"
          aria-selected={i === selectedIndex}
          className="start-work__row"
          onClick={() => actions.select(i)}
        >
          <GitBranch aria-hidden="true" />
          <span className="start-work__key" />
          <span>{row.kind === 'branch' ? row.name : ''}</span>
          <Chip>{row.kind === 'branch' && row.hasWorktree ? 'Worktree' : 'Branch'}</Chip>
        </div>
      ))}
    </>
  )
}

function RunAsPanel({ view, actions }: Launcher): JSX.Element {
  if (view.tab === 'scratch') return <div className="start-work__side" />
  return (
    <div className="start-work__side">
      <div className="start-work__label">Run it as</div>
      <div role="radiogroup" aria-label="Run it as" className="start-work__options">
        {view.runAsOptions.map((option) => (
          <div
            key={option.value}
            role="radio"
            aria-checked={view.runAs === option.value}
            aria-label={option.label}
            className="start-work__option"
            onClick={() => actions.setRunAs(option.value)}
          >
            <span className="start-work__radio" aria-hidden="true" />
            <span>
              {option.label}
              <small>{option.hint}</small>
            </span>
          </div>
        ))}
      </div>
      <Summary {...{ view, actions }} />
    </div>
  )
}

function summaryOf(view: Launcher['view']): { branch: string; worktree: string } {
  const { selected } = view
  if (selected?.kind === 'ticket') {
    const branch = branchOf(selected.issue)
    return { branch, worktree: worktreeFolder(branch) }
  }
  if (selected?.kind === 'branch')
    return { branch: selected.name, worktree: worktreeFolder(selected.name) }
  return { branch: view.git.base ?? '', worktree: 'the repo folder' }
}

function Summary({ view, actions }: PartProps): JSX.Element {
  const { branch, worktree } = summaryOf(view)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  return (
    <>
      <dl className="start-work__summary" role="group" aria-label="Where it runs">
        <dt>Repo</dt>
        <dd>{view.repo?.name ?? 'none'}</dd>
        <dt>Branch</dt>
        <dd>{branch}</dd>
        <dt>Worktree</dt>
        <dd>{worktree}</dd>
        <dt>From</dt>
        <dd>{view.git.base ?? ''}</dd>
      </dl>
      {view.picking && (
        <ul className="start-work__repos" role="listbox" aria-label="Repo">
          {workspaces.map((w) => (
            <li key={w.id} role="option" aria-selected={w.id === view.repo?.id}>
              <button type="button" onClick={() => actions.pickRepo(w.id)}>
                {w.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function startLabel(view: Launcher['view']): string {
  if (view.tab === 'scratch') return 'Start terminal'
  if (view.selected?.kind === 'ticket') return `Start ${view.selected.issue.key}`
  return 'Start'
}

function Footer({ view, actions }: Launcher): JSX.Element {
  return (
    <div className="start-work__footer">
      <span>
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> choose
      </span>
      <span>
        <Kbd>Tab</Kbd> run as
      </span>
      <span>
        <Kbd>⌘R</Kbd> change repo
      </span>
      {view.error !== null && (
        <span role="alert" className="start-work__error">
          {view.error}
        </span>
      )}
      <Button variant="primary" size="sm" onClick={() => void actions.start()}>
        {startLabel(view)}
        <Kbd>↵</Kbd>
      </Button>
    </div>
  )
}
