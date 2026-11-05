import React, { useState } from 'react'
import { Bot, GitBranch, Plus } from 'lucide-react'
import { Button, Chip, Kbd, ModalShell, Tab, TabList, TabsRoot } from '@terminator/extension-ui'
import { WorkspacePicker } from './WorkspacePicker'
import { AcrossRepos } from './AcrossRepos'
import { RunAsChoices } from './RunAsChoices'
import { promptBranch } from '../../../shared/home/branch-name'
import { WhenChoices, type WhenValue } from './WhenChoices'
import { agentLabel, useAgentChoices } from './agent-choices'
import { startScratchSession } from '../../terminal/start-session'
import { recordUse } from '../../usage/record'
import {
  branchOf,
  cycleRunAs,
  isAgentRun,
  startWork,
  useRunAsOptions,
  useStartWorkStore,
  worktreeFolder,
  type RunAs,
  type WorkRequest,
} from './start-work'
import {
  NO_GIT,
  useAgentBranchName,
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
  { id: 'across', label: 'Across repos' },
  { id: 'scratch', label: 'Scratch terminal' },
]

/** Today as 'YYYY-MM-DD', local. */
const today = (): string => new Date().toLocaleDateString('sv-SE')

/** What the person has typed, picked and been told so far. */
function useLauncherFields() {
  const prefill = useStartWorkStore.getState().prefill
  const [tab, setTab] = useState<LauncherTab>('tickets')
  const [query, setQuery] = useState(prefill)
  const [runAs, setRunAs] = useState<RunAs>('agent')
  const [agentId, setAgentId] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [pickedRepoId, setPickedRepoId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [when, setWhen] = useState<WhenValue>({ when: 'now', time: '09:00', date: today() })
  const [useRepoFolder, setUseRepoFolder] = useState(false)
  return {
    ...{ tab, query, runAs, agentId, selectedIndex, pickedRepoId, picking, error },
    ...{ setTab, setQuery, setRunAs, setAgentId, setSelectedIndex, setPickedRepoId },
    ...{ setPicking, setError, when, setWhen, useRepoFolder, setUseRepoFolder },
  }
}

type Fields = ReturnType<typeof useLauncherFields>

/** The lists, the selected row and the repo, which depend on one another in that order. */
function useLauncherData(fields: Fields) {
  const { tab, query, selectedIndex, pickedRepoId } = fields
  const issues = useMyTickets()
  const ticketRows = useRows({ tab, query, issues, git: NO_GIT }).rows
  const { workspace: repo, reason: repoReason } = useChosenRepo(
    ticketRows[selectedIndex],
    pickedRepoId
  )
  const git = useRepoGit(repo)
  const { groups, rows } = useRows({ tab, query, issues, git })
  const index = Math.max(0, Math.min(selectedIndex, rows.length - 1))
  return {
    repo,
    repoReason,
    git,
    groups,
    rows,
    selected: rows[index] as LauncherRow | undefined,
    index,
  }
}

function useLauncher(onClose: () => void) {
  const fields = useLauncherFields()
  const data = useLauncherData(fields)
  const { tab, query, runAs, agentId, picking, error } = fields
  const choices = useAgentChoices()
  const runAsOptions = useRunAsOptions(agentLabel(choices, agentId))
  const { when, useRepoFolder } = fields
  const isPrompt = tab === 'prompt' || data.selected?.kind === 'prompt'
  // A prompt run by an agent gets a branch of its own unless the person chose the repo folder.
  const ownBranch = isPrompt && isAgentRun(runAs) && !useRepoFolder
  const agentBranch = useAgentBranchName(query.trim(), ownBranch)
  const view = { tab, query, runAs, agentId, choices, picking, error, runAsOptions, ...data }
  const promptView = { when, useRepoFolder, isPrompt, ownBranch, agentBranch }
  const actions = launcherActions({ fields, view: { ...view, ...promptView }, onClose })
  return { view: { ...view, ...promptView }, actions, selectedIndex: data.index }
}

interface ActionsInput {
  fields: Fields
  view: {
    tab: LauncherTab
    query: string
    runAs: RunAs
    agentId: string | null
    selected?: LauncherRow
    repo: Workspace | null
    when: WhenValue
    useRepoFolder: boolean
    isPrompt: boolean
    ownBranch: boolean
    agentBranch: string | null
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
    setAgentId: fields.setAgentId,
    setWhen: fields.setWhen,
    setUseRepoFolder: fields.setUseRepoFolder,
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
  const { selected, runAs, agentId, query, isPrompt, ownBranch, agentBranch } = view
  const common = { workspace: repo, runAs, ...(agentId === null ? {} : { agentId }) }
  if (isPrompt) {
    if (query.trim() === '') return null
    const branch = agentBranch === null ? {} : { branch: agentBranch }
    return { kind: 'prompt', text: query, newWorktree: ownBranch, ...branch, ...common }
  }
  if (selected?.kind === 'ticket') return { kind: 'ticket', issue: selected.issue, ...common }
  if (selected?.kind === 'branch') return { kind: 'branch', branch: selected.name, ...common }
  return null
}

async function submit({ view, onClose, setError }: SubmitInput): Promise<void> {
  if (view.tab === 'scratch') {
    onClose()
    return void startScratchSession()
  }
  if (view.repo === null) return setError('Add a workspace in the sidebar first.')
  const request = requestFor(view, view.repo)
  if (request === null) return
  const message =
    view.when.when === 'now' ? await startWork(request) : await schedule(view, request)
  if (message === null) {
    recordUse(view.when.when === 'now' ? 'core.start-work.launch' : SCHEDULE_FEATURE, 'click', {
      declare: view.when.when === 'now' ? undefined : SCHEDULE_DECLARATION,
    })
    onClose()
  } else setError(message)
}

const SCHEDULE_FEATURE = 'core.start-work.schedule'
const SCHEDULE_DECLARATION = {
  label: 'Schedule a prompt',
  kind: 'control' as const,
  source: 'core',
}

/** Saves the prompt to run later. Null when saved; otherwise what to tell the person. */
async function schedule(view: ActionsInput['view'], request: WorkRequest): Promise<string | null> {
  if (request.kind !== 'prompt') return 'Only a typed prompt can be scheduled.'
  const { when, time, date } = view.when
  const result = await window.electronAPI.schedules.create({
    repoRoot: request.workspace.folderPath,
    prompt: request.text.trim(),
    runAs: request.runAs,
    kind: when === 'now' ? 'daily' : when,
    time,
    date: when === 'once' ? date : null,
  })
  return 'data' in result ? null : result.message
}

/** The launcher: pick a ticket, a prompt or a branch, choose how to run it, press Enter. */
export function StartWork({ onClose }: { onClose: () => void }): React.JSX.Element {
  const launcher = useLauncher(onClose)
  const { view, actions } = launcher
  return (
    <ModalShell label="Start work" placement="top" onDismiss={actions.dismiss}>
      <div className="start-work" onKeyDown={(e) => handleKey(e, launcher)}>
        {view.tab !== 'across' && <SearchRow {...{ view, actions }} />}
        <TabRow {...{ view, actions }} />
        {view.tab === 'across' ? <AcrossRepos onClose={onClose} /> : <LauncherBody {...launcher} />}
      </div>
    </ModalShell>
  )
}

function LauncherBody(launcher: Launcher): React.JSX.Element {
  return (
    <>
      <div className="start-work__body">
        <ChoiceList {...launcher} />
        <RunAsPanel {...launcher} />
      </div>
      <Footer {...launcher} />
    </>
  )
}

function handleKey(e: React.KeyboardEvent, { view, actions, selectedIndex }: Launcher): void {
  if (view.tab === 'across') return
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
  across: 'Not used on this tab',
  scratch: 'Nothing to type for a scratch terminal',
}

function SearchRow({ view, actions }: PartProps): React.JSX.Element {
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

function TabRow({ view, actions }: PartProps): React.JSX.Element {
  const ticketKey = view.selected?.kind === 'ticket' ? view.selected.issue.key : null
  return (
    <TabsRoot selectedId={view.tab} onSelect={actions.setTab}>
      <TabList label="Start work from" className="start-work__tabs">
        {TABS.map((tab) => (
          <Tab key={tab.id} id={tab.id}>
            {tab.label}
          </Tab>
        ))}
        {view.tab !== 'scratch' && view.tab !== 'across' && (
          <WorkspacePicker
            current={view.repo}
            reason={view.repoReason}
            ticketKey={ticketKey}
            open={view.picking}
            onToggle={actions.togglePicker}
            onPick={actions.pickRepo}
            onClose={() => actions.dismiss()}
          />
        )}
      </TabList>
    </TabsRoot>
  )
}

const HINTS: Partial<Record<LauncherTab, string>> = {
  prompt: 'Type the task above. Enter starts it.',
  scratch: 'A terminal that belongs to no branch. Enter opens it.',
}

function ChoiceList({ view, actions, selectedIndex }: Launcher): React.JSX.Element {
  const hint = HINTS[view.tab]
  return (
    <div className="start-work__list" role="listbox" aria-label="Choices">
      {hint !== undefined && <p className="start-work__hint">{hint}</p>}
      {view.tab === 'tickets' && <TicketRows {...{ view, actions, selectedIndex }} />}
      {view.tab === 'branch' && <BranchRows {...{ view, actions, selectedIndex }} />}
    </div>
  )
}

function TicketRows({ view, actions, selectedIndex }: Launcher): React.JSX.Element {
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

function TicketRow({ issue, selected, onSelect }: TicketRowProps): React.JSX.Element {
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

function PromptRow({ text, selected, onSelect }: PromptRowProps): React.JSX.Element {
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

function BranchRows({ view, actions, selectedIndex }: Launcher): React.JSX.Element {
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

function RunAsPanel({ view, actions }: Launcher): React.JSX.Element {
  if (view.tab === 'scratch') return <div className="start-work__side" />
  return (
    <div className="start-work__side">
      <div className="start-work__label">Run it as</div>
      <RunAsChoices options={view.runAsOptions} runAs={view.runAs} onPick={actions.setRunAs} />
      <AgentPicker view={view} actions={actions} />
      {view.isPrompt && isAgentRun(view.runAs) && <RepoFolderChoice {...{ view, actions }} />}
      {view.isPrompt && <WhenChoices value={view.when} onChange={actions.setWhen} />}
      <Summary {...{ view, actions }} />
    </div>
  )
}

function AgentPicker({ view, actions }: PartProps): React.JSX.Element | null {
  const { agents, defaultId } = view.choices
  if (agents.length < 2 || view.runAs !== 'agent') return null
  return (
    <label className="start-work__agent">
      Agent
      <select
        value={view.agentId ?? defaultId}
        onChange={(e) => actions.setAgentId(e.target.value)}
      >
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function RepoFolderChoice({ view, actions }: PartProps): React.JSX.Element {
  return (
    <label className="start-work__agent">
      <input
        type="checkbox"
        checked={view.useRepoFolder}
        onChange={(e) => actions.setUseRepoFolder(e.target.checked)}
      />
      Use the repo folder
    </label>
  )
}

function summaryOf(view: Launcher['view']): { branch: string; worktree: string } {
  const { selected } = view
  if (view.isPrompt && view.ownBranch) {
    const branch = view.agentBranch ?? promptBranch(view.query)
    return { branch, worktree: 'a new worktree' }
  }
  if (selected?.kind === 'ticket') {
    const branch = branchOf(selected.issue)
    return { branch, worktree: worktreeFolder(branch) }
  }
  if (selected?.kind === 'branch')
    return { branch: selected.name, worktree: worktreeFolder(selected.name) }
  return { branch: view.git.base ?? '', worktree: 'the repo folder' }
}

function Summary({ view }: PartProps): React.JSX.Element {
  const { branch, worktree } = summaryOf(view)
  return (
    <dl className="start-work__summary" role="group" aria-label="Where it runs">
      <dt>Branch</dt>
      <dd>
        {branch}
        {view.ownBranch && view.agentBranch !== null && (
          <span className="start-work__muted"> named by Claude</span>
        )}
      </dd>
      <dt>Worktree</dt>
      <dd>{worktree}</dd>
      <dt>From</dt>
      <dd>{view.git.base ?? ''}</dd>
    </dl>
  )
}

function startLabel(view: Launcher['view']): string {
  if (view.tab === 'scratch') return 'Start terminal'
  if (view.isPrompt && view.when.when !== 'now') return 'Schedule'
  if (view.selected?.kind === 'ticket') return `Start ${view.selected.issue.key}`
  return 'Start'
}

function Footer({ view, actions }: Launcher): React.JSX.Element {
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
        <Kbd>⌘R</Kbd> workspace
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
