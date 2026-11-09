import { useMemo } from 'react'
import { create } from 'zustand'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionStore } from '../../stores/session.store'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { useSessionRecordsStore } from '../../stores/session-records.store'
import { useExtensionRegistry, type StartWorkOptionRegistration } from '../../extensions/registry'
import { registeredCommandKey } from '../../stores/extension-commands.store'
import {
  agentCommand,
  startAgentInBranch,
  startSessionInBranch,
} from '../../terminal/start-session'
import { openSnapshot } from '../../sidebar/session-facts'
import { createFromDraft } from '../sidebar/create-project'
import { useDismissedThreads } from './dismissed-threads'
import { workKeyId } from '../../home/work-threads'
import { promptBranch, semanticBranch } from '../../../../core-shared/src/home/branch-name'
import type { IssueSummary, Workspace } from '../../../../core-shared/src/types/index'
import type {
  Schedule,
  UnattendedLaunch,
} from '../../../../core-shared/src/schemas/schedules.schema'

// What the Start work launcher decides and does, apart from how it is drawn.

/** Whether the launcher is showing; ⌘N, the Home button and the Quick actions entry open it. */
export const useStartWorkStore = create<{
  open: boolean
  /** Text the launcher opens with in its prompt box. */
  prefill: string
  /** The scheduled run the launcher edits; null when it starts new work. */
  editing: Schedule | null
  /** Opens on the Prompt tab with When set to Repeat: Home's "New scheduled run". */
  repeat: boolean
  openLauncher: (prefill?: string, editing?: Schedule | null) => void
  openScheduledRun: () => void
  closeLauncher: () => void
}>((set) => ({
  open: false,
  prefill: '',
  editing: null,
  repeat: false,
  openLauncher: (prefill = '', editing = null) =>
    set({ open: true, prefill, editing, repeat: false }),
  openScheduledRun: () => set({ open: true, prefill: '', editing: null, repeat: true }),
  closeLauncher: () => set({ open: false, prefill: '', editing: null, repeat: false }),
}))

/** 'agent', 'claude-terminal', 'terminal', or the key of an extension's start-work option. */
export type RunAs = string

export interface RunAsOption {
  value: RunAs
  label: string
  hint: string
}

function builtInRunAs(agentName: string): RunAsOption[] {
  return [
    {
      value: 'agent',
      label: `${agentName} in an agent tab`,
      hint: 'The ticket or prompt is its first message. Its questions show in the tab and on the Desk.',
    },
    {
      value: 'claude-terminal',
      label: 'Claude in a terminal',
      hint: 'The claude program in a shell, as before.',
    },
    { value: 'terminal', label: 'Terminal only', hint: 'A shell in the new worktree.' },
  ]
}

/** The agent tab, Claude in a terminal and Terminal only, then every option an extension declared. */
export function useRunAsOptions(agentName: string): RunAsOption[] {
  const registered = useExtensionRegistry((s) => s.startWorkOptions)
  return useMemo(
    () => [
      ...builtInRunAs(agentName),
      ...[...registered.values()].map((o) => ({
        value: o.key,
        label: o.label,
        hint: o.description,
      })),
    ],
    [registered, agentName]
  )
}

/** The option Tab moves to; Shift+Tab goes back. */
export function cycleRunAs(options: readonly RunAsOption[], current: RunAs, step: 1 | -1): RunAs {
  const index = options.findIndex((o) => o.value === current)
  return options[(index + step + options.length) % options.length].value
}

// Linear's state types, in the order a person works them. Priority is not used.
const STATE_GROUPS = [
  { type: 'started', label: 'In progress' },
  { type: 'unstarted', label: 'Todo' },
  { type: 'backlog', label: 'Backlog' },
  { type: 'triage', label: 'Triage' },
]

export interface TicketGroup {
  label: string
  issues: IssueSummary[]
}

/** The tickets that match `query` by key or title, grouped by state type; empty groups are left out. */
export function groupTickets(issues: IssueSummary[], query: string): TicketGroup[] {
  const needle = query.trim().toLowerCase()
  const matches = issues.filter(
    (i) => i.key.toLowerCase().includes(needle) || i.title.toLowerCase().includes(needle)
  )
  return STATE_GROUPS.map(({ type, label }) => ({
    label,
    issues: matches.filter((i) => i.state.type === type),
  })).filter((group) => group.issues.length > 0)
}

const teamOf = (key: string): string => key.split('-')[0]

export type SuggestionReason = 'linked-ticket' | 'active' | 'first'

/** The repo whose branch last linked a ticket of this ticket's team, else the one in use, else the first. */
export function defaultWorkspaceId(issue: IssueSummary | null): {
  id: string | null
  reason: SuggestionReason
} {
  const { workspaces, projectsByWorkspaceId, activeWorkspaceId } = useWorkspaceStore.getState()
  const fallback =
    activeWorkspaceId === null
      ? { id: workspaces[0]?.id ?? null, reason: 'first' as const }
      : { id: activeWorkspaceId, reason: 'active' as const }
  if (issue === null) return fallback
  const { links } = useIntegrationsStore.getState()
  const linked = [...projectsByWorkspaceId.values()]
    .flat()
    .filter((p) => {
      const link = links.get(p.id)
      return link != null && teamOf(link.key) === teamOf(issue.key)
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const linkedId = linked[0]?.workspaceId
  return linkedId === undefined ? fallback : { id: linkedId, reason: 'linked-ticket' }
}

/** The branch a ticket is worked on: Linear's own suggestion, else its key. */
export const branchOf = (issue: IssueSummary): string => issue.branchName ?? issue.key.toLowerCase()

export const worktreeFolder = (branch: string): string => `.worktrees/${branch}`

/** How long the person waits for the agent to name a branch before the plain name is used. @internal */
export const NAMING_WAIT_MS = 5_000

/** The agent's `feat/…` or `fix/…` name for the prompt; null when it was late, failed or gave no name. */
export async function askBranchName(prompt: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => (timer = setTimeout(resolve, NAMING_WAIT_MS, null)))
  const named = window.electronAPI.homeBranchName
    .get({ prompt })
    .then((reply) => ('text' in reply ? semanticBranch(reply.text) : null))
    .catch(() => null)
  try {
    return await Promise.race([named, late])
  } finally {
    clearTimeout(timer)
  }
}

/** The agent runs that get a branch of their own; a plain terminal stays in the repo folder. */
export const isAgentRun = (runAs: RunAs): boolean =>
  runAs === 'agent' || runAs === 'claude-terminal'

const PROMPT_TOO_LONG = 'That prompt is too long to start an agent with. Shorten it.'

/** Why a global prompt did not start, in plain words. */
export const globalStartFailure = (
  text: string,
  runAs: RunAs,
  unattended?: UnattendedLaunch
): string =>
  runAs === 'claude-terminal' && agentCommand(text, unattended) === null
    ? PROMPT_TOO_LONG
    : 'The agent could not be started.'

const ticketPrompt = (issue: IssueSummary): string =>
  `Work on ${issue.key}: ${issue.title} (${issue.url})`

export type WorkRequest = {
  workspace: Workspace
  runAs: RunAs
  agentId?: string
  /** A scheduled run's files; absent for work a person started. A run with them stays in the
   * background. */
  unattended?: UnattendedLaunch
  /** Told the session the work opened, once it started. */
  onStarted?: (sessionId: string) => void
} & (
  | { kind: 'ticket'; issue: IssueSummary }
  /** `newWorktree` runs it on a branch of its own: `branch` when given, else one the agent names. */
  | { kind: 'prompt'; text: string; newWorktree?: boolean; branch?: string }
  /** `prompt` is what the agent is first told on this branch; none starts it with nothing. */
  | { kind: 'branch'; branch: string; prompt?: string }
)

type Outcome = string | null

const branchCardsOf = (workspaceId: string) =>
  useWorkspaceStore.getState().projectsByWorkspaceId.get(workspaceId) ?? []

/** Why a worktree was refused, in words that need no git knowledge. */
function refusalMessage(workspace: Workspace, branch: string, message: string): string {
  if (!message.startsWith('Worktree error')) return message
  return `Could not set up ${branch} in ${workspace.name}. Check that the branch is not already checked out somewhere else.`
}

/** The card for `branch` in this repo, creating its worktree first when it has none. */
async function projectForBranch(workspace: Workspace, branch: string): Promise<string | Error> {
  const existing = branchCardsOf(workspace.id).find((p) => p.gitBranch === branch)
  if (existing !== undefined) return existing.id
  const repo = await window.electronAPI.git.isRepo(workspace.folderPath)
  if ('error' in repo) return new Error(`Could not read the git repository of ${workspace.name}.`)
  if (!repo.isRepo || !repo.root) return new Error(`${workspace.name} is not a git repo.`)
  const { branches } = await window.electronAPI.git.listBranches(repo.root)
  const created = await createFromDraft({
    workspaceId: workspace.id,
    folderPath: workspace.folderPath,
    gitRoot: repo.root,
    draft: {
      name: '',
      branchMode: 'worktree',
      selectedBranch: branch,
      newBranchName: branch,
      isNewBranch: false,
      worktreeIsNewBranch: !branches.some((b) => b.name === branch),
      worktreePath: `${repo.root}/${worktreeFolder(branch)}`,
    },
  })
  if (typeof created === 'string') return created
  return new Error(refusalMessage(workspace, branch, created.message))
}

/** The repo's own checkout: the first card that is not a worktree. */
function mainProjectId(workspace: Workspace): string | Error {
  const projects = branchCardsOf(workspace.id)
  const main = projects.find((p) => !p.isWorktree) ?? projects[0]
  return main?.id ?? new Error(`Add a branch to ${workspace.name} first, then start it there.`)
}

async function promptProject(request: WorkRequest & { kind: 'prompt' }): Promise<string | Error> {
  if (request.newWorktree !== true) return mainProjectId(request.workspace)
  const branch = request.branch ?? (await askBranchName(request.text)) ?? promptBranch(request.text)
  return projectForBranch(request.workspace, branch)
}

const projectFor = (request: WorkRequest): Promise<string | Error> | string | Error =>
  request.kind === 'ticket'
    ? projectForBranch(request.workspace, branchOf(request.issue))
    : request.kind === 'branch'
      ? projectForBranch(request.workspace, request.branch)
      : promptProject(request)

function promptOf(request: WorkRequest): string | null {
  if (request.kind === 'ticket') return ticketPrompt(request.issue)
  if (request.kind === 'branch') return request.prompt ?? null
  return request.kind === 'prompt' ? request.text : null
}

/** The line to type in the new terminal: nothing for a plain shell or an agent tab. */
function commandFor(request: WorkRequest): string | undefined | Error {
  if (request.runAs !== 'claude-terminal') return undefined
  const command = agentCommand(promptOf(request), request.unattended)
  return command ?? new Error(PROMPT_TOO_LONG)
}

/** What an extension's start-work command is given when a ticket or a prompt was chosen. */
function optionArgs(request: WorkRequest): object | undefined {
  if (request.kind === 'prompt')
    return { prompt: request.text, repoRoot: request.workspace.folderPath }
  if (request.kind !== 'ticket') return undefined
  const { tracker, key, title } = request.issue
  return { tracker, key, title, repoRoot: request.workspace.folderPath }
}

/** The extension's own command for this option, given the chosen ticket when there is one. */
async function startExtensionOption(option: StartWorkOptionRegistration, request: WorkRequest) {
  const key = await registeredCommandKey(option.extensionId, option.command)
  if (key === null) return `${option.label} is not turned on, so it cannot take this.`
  const context = { projectId: null, sessionId: null, repoRoot: request.workspace.folderPath }
  window.electronAPI.extension.executeCommand(key, context, optionArgs(request))
  restoreStarted(request)
  return null
}

/** Writes the ticket onto the session that was just opened. */
async function linkTicket(sessionId: string, issue: IssueSummary): Promise<void> {
  const session = useSessionStore.getState().sessions.get(sessionId)
  if (session === undefined) return
  const project = [...useWorkspaceStore.getState().projectsByWorkspaceId.values()]
    .flat()
    .find((p) => p.id === session.projectId)
  const workspace = useWorkspaceStore
    .getState()
    .workspaces.find((w) => w.id === project?.workspaceId)
  const ref = { tracker: issue.tracker, key: issue.key }
  await useSessionRecordsStore.getState().setLink(openSnapshot(session, project, workspace), ref)
}

/** Starting work on purpose undoes an earlier dismissal of it. Prompts have no thread to restore. */
function restoreStarted(request: WorkRequest): void {
  const { folderPath } = request.workspace
  if (request.kind === 'prompt') return
  const key =
    request.kind === 'ticket'
      ? workKeyId({ tracker: request.issue.tracker, key: request.issue.key })
      : workKeyId({ repoRoot: folderPath, branch: request.branch })
  useDismissedThreads.getState().restore(key)
}

/** Does the work. Null when it started; otherwise what to tell the person, in plain words. */
export async function startWork(request: WorkRequest): Promise<Outcome> {
  const option = useExtensionRegistry.getState().startWorkOptions.get(request.runAs)
  if (option !== undefined) return startExtensionOption(option, request)
  const command = commandFor(request)
  if (command instanceof Error) return command.message
  const projectId = await projectFor(request)
  if (projectId instanceof Error) return projectId.message
  const sessionId =
    request.runAs === 'agent'
      ? await startAgentInBranch({
          projectId,
          title: request.kind === 'ticket' ? request.issue.key : 'Agent',
          prompt: promptOf(request),
          agentId: request.agentId,
          unattended: request.unattended,
        })
      : await startSessionInBranch(projectId, command, request.unattended !== undefined)
  if (sessionId === null)
    return request.runAs === 'agent'
      ? 'The agent could not be started.'
      : 'The terminal could not be opened.'
  if (request.kind === 'ticket') await linkTicket(sessionId, request.issue)
  restoreStarted(request)
  request.onStarted?.(sessionId)
  return null
}
