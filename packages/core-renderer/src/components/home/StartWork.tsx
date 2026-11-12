import { useExtensionRegistry } from '../../extensions/registry'
import React, { useState } from 'react'
import { Bot, GitBranch, Plus } from 'lucide-react'
import { Button, Chip, Kbd, ModalShell, Tab, TabList, TabsRoot } from '@terminator/extension-ui'
import { WorkspacePicker } from './WorkspacePicker'
import { AcrossRepos } from './AcrossRepos'
import { RunAsChoices } from './RunAsChoices'
import { promptBranch } from '../../../../core-shared/src/home/branch-name'
import { PromptPane } from './PromptPane'
import { runLabel, whenProblem, type WhenValue } from './WhenChoices'
import { agentLabel, useAgentChoices } from './agent-choices'
import { startGlobalPrompt, startScratchSession } from '../../terminal/start-session'
import { recordUse } from '../../usage/record'
import { saveSchedule, startingFields } from './start-work-edit'
import { nextRunOf } from './scheduled-runs'
import {
  branchOf,
  cycleRunAs,
  globalStartFailure,
  isAgentRun,
  openWorkspaceTerminal,
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
import type { IssueSummary, Workspace } from '../../../../core-shared/src/types/index'
import type { Schedule } from '../../../../core-shared/src/schemas/schedules.schema'
import './StartWork.css'

const TABS: Array<{ id: LauncherTab; label: string }> = [
  { id: 'tickets', label: 'My tickets' },
  { id: 'prompt', label: 'Prompt' },
  { id: 'branch', label: 'Branch' },
  { id: 'across', label: 'Across repos' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'scratch', label: 'Scratch terminal' },
]

/** What the person has typed, picked and been told so far. */
function useLauncherFields() {
  const { prefill, editing, repeat } = useStartWorkStore.getState()
  const [start] = useState(() => {
    const fields = startingFields(prefill, editing)
    // Home's "New scheduled run" opens on a repeating prompt.
    if (!repeat) return fields
    return { ...fields, tab: 'prompt' as const, when: { ...fields.when, when: 'repeat' as const } }
  })
  const [tab, setTab] = useState<LauncherTab>(start.tab)
  const [query, setQuery] = useState(start.query)
  const [runAs, setRunAs] = useState<RunAs>(start.runAs)
  const [agentId, setAgentId] = useState<string | null>(start.agentId)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [pickedRepoId, setPickedRepoId] = useState<string | null>(start.pickedRepoId)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [when, setWhen] = useState<WhenValue>(start.when)
  const [useRepoFolder, setUseRepoFolder] = useState(start.useRepoFolder)
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
  const {
    workspace: repo,
    reason: repoReason,
    global,
  } = useChosenRepo(ticketRows[selectedIndex], pickedRepoId)
  const git = useRepoGit(repo)
  const { groups, rows } = useRows({ tab, query, issues, git })
  const index = Math.max(0, Math.min(selectedIndex, rows.length - 1))
  return {
    repo,
    repoReason,
    global,
    git,
    groups,
    rows,
    selected: rows[index] as LauncherRow | undefined,
    index,
  }
}

/** The ways to run it: a global run has no workspace, so only the agent tab and Claude in a terminal. */
function useRunAs(fields: Fields, global: boolean) {
  const choices = useAgentChoices()
  const all = useRunAsOptions(agentLabel(choices, fields.agentId))
  const runAsOptions = global ? all.filter((o) => isAgentRun(o.value)) : all
  const allowed = runAsOptions.some((o) => o.value === fields.runAs)
  return { choices, runAsOptions, runAs: allowed ? fields.runAs : 'agent' }
}

function useLauncher(onClose: () => void) {
  const fields = useLauncherFields()
  const data = useLauncherData(fields)
  const editing = useStartWorkStore((s) => s.editing)
  const { tab, query, agentId, picking, error } = fields
  const { choices, runAsOptions, runAs } = useRunAs(fields, data.global)
  const { when, useRepoFolder } = fields
  const isPrompt = tab === 'prompt' || data.selected?.kind === 'prompt'
  // A prompt run by an agent gets a branch of its own unless the person chose the repo folder.
  const ownBranch = isPrompt && isAgentRun(runAs) && !useRepoFolder && !data.global
  const agentBranch = useAgentBranchName(query.trim(), ownBranch)
  const view = { tab, query, runAs, agentId, choices, picking, error, runAsOptions, ...data }
  const repoPicked = fields.pickedRepoId !== null
  const promptView = { when, useRepoFolder, isPrompt, ownBranch, agentBranch, editing, repoPicked }
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
    global: boolean
    editing: Schedule | null
    when: WhenValue
    useRepoFolder: boolean
    isPrompt: boolean
    ownBranch: boolean
    agentBranch: string | null
    repoPicked: boolean
  }
  onClose: () => void
}

function launcherActions({ fields, view, onClose }: ActionsInput) {
  const fresh = (): void => (fields.setSelectedIndex(0), fields.setError(null))
  return {
    setTab: (next: LauncherTab) => {
      fields.setTab(next)
      // Scheduling and Global are chosen on the Prompt tab only.
      if (next !== 'prompt') fields.setWhen({ ...view.when, when: 'now' })
      if (next !== 'prompt' && view.global) fields.setPickedRepoId(null)
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

/** Starts or saves the choice: null when done, the reason when not, undefined when nothing was typed. */
async function launch(view: ActionsInput['view']): Promise<string | null | undefined> {
  if (view.isPrompt && view.query.trim() === '') return undefined
  if (view.when.when !== 'now') return saveSchedule(view)
  if (view.global) return startGlobal(view)
  const request = view.repo === null ? null : requestFor(view, view.repo)
  return request === null ? undefined : startWork(request)
}

async function startGlobal({
  query,
  runAs,
  agentId,
}: ActionsInput['view']): Promise<string | null> {
  const text = query.trim()
  const agent = agentId === null ? {} : { agentId }
  const sessionId = await startGlobalPrompt({ text, runAs, ...agent })
  return sessionId === null ? globalStartFailure(text, runAs) : null
}

async function submit({ view, onClose, setError }: SubmitInput): Promise<void> {
  if (view.tab === 'scratch') {
    onClose()
    return void startScratchSession()
  }
  if (view.tab === 'terminal') return startTerminal(view, onClose, setError)
  if (view.repo === null && !view.global) return setError('Add a workspace in the sidebar first.')
  const problem = scheduleProblem(view)
  if (problem !== null) return setError(problem)
  const message = await launch(view)
  if (message === undefined) return
  if (message === null) {
    recordUse(view.when.when === 'now' ? 'core.start-work.launch' : SCHEDULE_FEATURE, 'click', {
      declare: view.when.when === 'now' ? undefined : SCHEDULE_DECLARATION,
    })
    onClose()
  } else setError(message)
}

async function startTerminal(
  view: ActionsInput['view'],
  onClose: () => void,
  setError: (message: string | null) => void
): Promise<void> {
  if (view.repo === null) return setError('Add a workspace in the sidebar first.')
  const message = await openWorkspaceTerminal(view.repo)
  if (message === null) onClose()
  else setError(message)
}

const SCHEDULE_FEATURE = 'core.start-work.schedule'
const SCHEDULE_DECLARATION = {
  label: 'Schedule a prompt',
  kind: 'control' as const,
  source: 'core',
}

/** The launcher: pick a ticket, a prompt or a branch, choose how to run it, press Enter. */
export function StartWork({ onClose }: { onClose: () => void }): React.JSX.Element {
  const launcher = useLauncher(onClose)
  const { view, actions } = launcher
  return (
    <ModalShell label="Start work" placement="top" onDismiss={actions.dismiss}>
      <div className="start-work" onKeyDown={(e) => handleKey(e, launcher)}>
        {(view.tab === 'tickets' || view.tab === 'branch') && <SearchRow {...{ view, actions }} />}
        {view.editing === null ? (
          <TabRow {...{ view, actions }} />
        ) : (
          <EditHead {...{ view, actions }} editing={view.editing} />
        )}
        {view.tab === 'across' ? <AcrossRepos onClose={onClose} /> : <LauncherBody {...launcher} />}
      </div>
    </ModalShell>
  )
}

function LauncherBody(launcher: Launcher): React.JSX.Element {
  return (
    <>
      <div className="start-work__body">
        {launcher.view.tab === 'prompt' ? (
          <PromptPane
            query={launcher.view.query}
            onType={launcher.actions.typeQuery}
            when={launcher.view.when}
            onWhen={launcher.actions.setWhen}
          />
        ) : (
          <ChoiceList {...launcher} />
        )}
        <RunAsPanel {...launcher} />
      </div>
      <Footer {...launcher} />
    </>
  )
}

/** Tab and Enter belong to the prompt box, the search box and the tab strip; on any other control
 * they do what that control does. */
const fromLauncherKeys = (target: EventTarget): boolean =>
  target instanceof HTMLTextAreaElement ||
  (target as Element).closest?.('.start-work__input, [role="tab"]') != null

function keyMoves(e: React.KeyboardEvent, { view, actions, selectedIndex }: Launcher) {
  // The Prompt tab's box keeps the arrow keys for moving the caret between lines.
  const arrows: Record<string, () => void> =
    view.tab === 'prompt'
      ? {}
      : {
          ArrowDown: () => actions.select(Math.min(selectedIndex + 1, view.rows.length - 1)),
          ArrowUp: () => actions.select(Math.max(selectedIndex - 1, 0)),
        }
  const moves: Record<string, () => void> = {
    ...arrows,
    Tab: () => actions.setRunAs(cycleRunAs(view.runAsOptions, view.runAs, e.shiftKey ? -1 : 1)),
    Enter: () => void actions.start(),
  }
  return moves
}

function handleKey(e: React.KeyboardEvent, launcher: Launcher): void {
  if (launcher.view.tab === 'across' || (e.key === 'Enter' && e.shiftKey)) return
  const isRepoKey = e.key.toLowerCase() === 'r' && (e.metaKey || e.ctrlKey)
  if (!isRepoKey && !fromLauncherKeys(e.target)) return
  const run = isRepoKey ? launcher.actions.togglePicker : keyMoves(e, launcher)[e.key]
  if (run === undefined) return
  e.preventDefault()
  run()
}

type PartProps = Pick<Launcher, 'view' | 'actions'>

const PLACEHOLDERS: Record<LauncherTab, string> = {
  tickets: 'Search tickets, or type a prompt',
  prompt: 'What should it do?',
  branch: 'Search branches',
  across: 'Not used on this tab',
  terminal: 'Nothing to type for a terminal',
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
        disabled={view.tab === 'scratch' || view.tab === 'terminal'}
        onChange={(e) => actions.typeQuery(e.target.value)}
      />
      <Kbd>Esc</Kbd>
    </div>
  )
}

function TabRow({ view, actions }: PartProps): React.JSX.Element {
  return (
    <TabsRoot selectedId={view.tab} onSelect={actions.setTab}>
      <TabList label="Start work from" className="start-work__tabs">
        {TABS.map((tab) => (
          <Tab key={tab.id} id={tab.id}>
            {tab.label}
          </Tab>
        ))}
        {view.tab !== 'scratch' && view.tab !== 'across' && <Picker {...{ view, actions }} />}
      </TabList>
    </TabsRoot>
  )
}

function Picker({ view, actions }: PartProps): React.JSX.Element {
  const ticketKey = view.selected?.kind === 'ticket' ? view.selected.issue.key : null
  return (
    <WorkspacePicker
      current={view.repo}
      global={view.global}
      offerGlobal={view.tab === 'prompt'}
      reason={view.repoReason}
      ticketKey={ticketKey}
      open={view.picking}
      onToggle={actions.togglePicker}
      onPick={actions.pickRepo}
      onClose={() => actions.dismiss()}
    />
  )
}

/** Edit mode's top: its title and the workspace in place of the tabs, then when it was made and run. */
function EditHead({ view, actions, editing }: PartProps & { editing: Schedule }) {
  const lastRun = editing.lastRunAt === null ? 'never' : runLabel(new Date(editing.lastRunAt))
  const nextRun = nextRunOf(editing, new Date())
  return (
    <>
      <div className="start-work__tabs">
        <h2 className="start-work__title">Edit scheduled run</h2>
        <Picker {...{ view, actions }} />
      </div>
      <p className="start-work__created">
        Created {runLabel(new Date(editing.createdAt))} · last run {lastRun} · next run{' '}
        {nextRun === null ? 'none' : runLabel(nextRun)}
      </p>
    </>
  )
}

const HINTS: Partial<Record<LauncherTab, string>> = {
  terminal: 'A shell in the workspace folder, on its current branch. Enter opens it.',
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

function TicketGroups({ view, actions, selectedIndex }: Launcher): React.JSX.Element {
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
    </>
  )
}

function TicketRows({ view, actions, selectedIndex }: Launcher): React.JSX.Element {
  const typed = view.query.trim()
  const promptIndex = rowsBefore(view.groups, view.groups.length)
  return (
    <>
      <TicketGroups {...{ view, actions, selectedIndex }} />
      {typed !== '' && view.groups.length === 0 && (
        <WriteAsPrompt onClick={() => actions.setTab('prompt')} />
      )}
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

function WriteAsPrompt({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" className="start-work__row start-work__write" onClick={onClick}>
      <Bot aria-hidden="true" />
      <span>Write it as a prompt</span>
    </button>
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
  if (view.tab === 'scratch' || view.tab === 'terminal') return <div className="start-work__side" />
  return (
    <div className="start-work__side">
      <div className="start-work__label">Run it as</div>
      <RunAsChoices options={view.runAsOptions} runAs={view.runAs} onPick={actions.setRunAs} />
      <AgentPicker view={view} actions={actions} />
      {view.isPrompt && isAgentRun(view.runAs) && !view.global && (
        <RepoFolderChoice {...{ view, actions }} />
      )}
      {view.global ? <GlobalSummary /> : <Summary {...{ view, actions }} />}
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
    <label className="start-work__agent start-work__inline">
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

/** Where a global run runs: the home folder, shown under Scratch. */
function GlobalSummary(): React.JSX.Element {
  return (
    <dl className="start-work__summary" role="group" aria-label="Where it runs">
      <dt>Runs in</dt>
      <dd>~ (your home folder)</dd>
      <dt>Shows in</dt>
      <dd>Scratch</dd>
    </dl>
  )
}

function startLabel(view: Launcher['view']): string {
  if (view.editing !== null) return 'Save changes'
  if (view.tab === 'scratch') return 'Start terminal'
  if (view.tab === 'terminal') return 'Open terminal'
  if (view.isPrompt && view.when.when !== 'now') return 'Schedule'
  if (view.selected?.kind === 'ticket') return `Start ${view.selected.issue.key}`
  return 'Start'
}

function Footer({ view, actions }: Launcher): React.JSX.Element {
  return (
    <div className="start-work__footer">
      {view.tab !== 'prompt' && (
        <span>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> choose
        </span>
      )}
      <span>
        <Kbd>Tab</Kbd> run as
      </span>
      <span>
        <Kbd>⌘R</Kbd> workspace
      </span>
      <FooterError view={view} />
      {view.editing !== null && (
        <Button size="sm" onClick={actions.dismiss}>
          Cancel
        </Button>
      )}
      <StartButton {...{ view, actions }} />
    </div>
  )
}

type ScheduleView = Pick<Launcher['view'], 'isPrompt' | 'runAs' | 'when'>

/** An extension's run makes a new thing each time (a Foundry order), so it cannot repeat. */
function repeatRefusal(view: ScheduleView): string | null {
  const option = useExtensionRegistry.getState().startWorkOptions.get(view.runAs)
  return option !== undefined && view.isPrompt && view.when.when === 'repeat'
    ? `${option.label} cannot repeat. Pick Once or Now.`
    : null
}

/** What stops this prompt being started or saved as chosen; null when nothing does. */
const scheduleProblem = (view: ScheduleView): string | null =>
  view.isPrompt ? (repeatRefusal(view) ?? whenProblem(view.when)) : null

function FooterError({ view }: { view: Launcher['view'] }): React.JSX.Element | null {
  const message = view.error ?? repeatRefusal(view)
  if (message === null) return null
  return (
    <span role="alert" className="start-work__error">
      {message}
    </span>
  )
}

function StartButton({ view, actions }: PartProps): React.JSX.Element {
  const blocked = scheduleProblem(view) !== null
  return (
    <Button variant="primary" size="sm" disabled={blocked} onClick={() => void actions.start()}>
      {startLabel(view)}
      <Kbd>↵</Kbd>
    </Button>
  )
}
