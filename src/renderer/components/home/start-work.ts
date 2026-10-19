import { create } from 'zustand'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionStore } from '../../stores/session.store'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { useSessionRecordsStore } from '../../stores/session-records.store'
import { useExtensionCommandsStore } from '../../stores/extension-commands.store'
import { startSessionInBranch } from '../../terminal/start-session'
import { openSnapshot } from '../../sidebar/session-facts'
import { createFromDraft } from '../sidebar/create-project'
import type { IssueSummary, Workspace } from '../../../shared/types/index'

// What the Start work launcher decides and does, apart from how it is drawn.

/** Whether the launcher is showing; ⌘N, the Home button and the Quick actions entry open it. */
export const useStartWorkStore = create<{
  open: boolean
  /** Text the launcher opens with in its prompt box. */
  prefill: string
  openLauncher: (prefill?: string) => void
  closeLauncher: () => void
}>((set) => ({
  open: false,
  prefill: '',
  openLauncher: (prefill = '') => set({ open: true, prefill }),
  closeLauncher: () => set({ open: false, prefill: '' }),
}))

export type RunAs = 'agent' | 'terminal' | 'foundry'

export const RUN_AS_OPTIONS: Array<{ value: RunAs; label: string; hint: string }> = [
  {
    value: 'agent',
    label: 'Claude agent',
    hint: 'Ticket injected as context. You answer its questions on the Desk.',
  },
  { value: 'terminal', label: 'Terminal only', hint: 'A shell in the new worktree.' },
  {
    value: 'foundry',
    label: 'Foundry order',
    hint: "Shaped, planned and built by Foundry's line.",
  },
]

/** The option Tab moves to; Shift+Tab goes back. */
export function cycleRunAs(current: RunAs, step: 1 | -1): RunAs {
  const index = RUN_AS_OPTIONS.findIndex((o) => o.value === current)
  return RUN_AS_OPTIONS[(index + step + RUN_AS_OPTIONS.length) % RUN_AS_OPTIONS.length].value
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

/** The repo whose branch last linked a ticket of this ticket's team, else the one in use. */
export function defaultWorkspaceId(issue: IssueSummary | null): string | null {
  const { workspaces, projectsByWorkspaceId, activeWorkspaceId } = useWorkspaceStore.getState()
  const fallback = activeWorkspaceId ?? workspaces[0]?.id ?? null
  if (issue === null) return fallback
  const { links } = useIntegrationsStore.getState()
  const linked = [...projectsByWorkspaceId.values()]
    .flat()
    .filter((p) => {
      const link = links.get(p.id)
      return link != null && teamOf(link.key) === teamOf(issue.key)
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return linked[0]?.workspaceId ?? fallback
}

/** The branch a ticket is worked on: Linear's own suggestion, else its key. */
export const branchOf = (issue: IssueSummary): string => issue.branchName ?? issue.key.toLowerCase()

export const worktreeFolder = (branch: string): string => `.worktrees/${branch}`

/** A line typed into a terminal is cut at 1024 bytes (PTY MAX_CANON); stay well inside it. */
const MAX_COMMAND_BYTES = 900

/** `claude '<prompt>'`, or plain `claude` for none; null when the line would be too long to type. */
export function agentCommand(prompt: string | null): string | null {
  if (prompt === null) return 'claude'
  const quoted = `'${prompt.replace(/\s+/g, ' ').trim().replace(/'/g, `'\\''`)}'`
  const command = `claude ${quoted}`
  return new TextEncoder().encode(command).length > MAX_COMMAND_BYTES ? null : command
}

export const ticketPrompt = (issue: IssueSummary): string =>
  `Work on ${issue.key}: ${issue.title} (${issue.url})`

export type WorkRequest = { workspace: Workspace; runAs: RunAs } & (
  | { kind: 'ticket'; issue: IssueSummary }
  | { kind: 'prompt'; text: string }
  | { kind: 'branch'; branch: string }
)

type Outcome = string | null

const projectsOf = (workspaceId: string) =>
  useWorkspaceStore.getState().projectsByWorkspaceId.get(workspaceId) ?? []

/** Why a worktree was refused, in words that need no git knowledge. */
function refusalMessage(workspace: Workspace, branch: string, message: string): string {
  if (!message.startsWith('Worktree error')) return message
  return `Could not set up ${branch} in ${workspace.name}. Check that the branch is not already checked out somewhere else.`
}

/** The card for `branch` in this repo, creating its worktree first when it has none. */
async function projectForBranch(workspace: Workspace, branch: string): Promise<string | Error> {
  const existing = projectsOf(workspace.id).find((p) => p.gitBranch === branch)
  if (existing !== undefined) return existing.id
  const repo = await window.electronAPI.git.isRepo(workspace.folderPath)
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
  const projects = projectsOf(workspace.id)
  const main = projects.find((p) => !p.isWorktree) ?? projects[0]
  return main?.id ?? new Error(`Add a branch to ${workspace.name} first, then start it there.`)
}

const projectFor = (request: WorkRequest): Promise<string | Error> | string | Error =>
  request.kind === 'ticket'
    ? projectForBranch(request.workspace, branchOf(request.issue))
    : request.kind === 'branch'
      ? projectForBranch(request.workspace, request.branch)
      : mainProjectId(request.workspace)

function promptOf(request: WorkRequest): string | null {
  if (request.kind === 'ticket') return ticketPrompt(request.issue)
  return request.kind === 'prompt' ? request.text : null
}

/** The line to type in the new terminal: nothing for a plain shell. */
function commandFor(request: WorkRequest): string | undefined | Error {
  if (request.runAs !== 'agent') return undefined
  const command = agentCommand(promptOf(request))
  return command ?? new Error('That prompt is too long to start an agent with. Shorten it.')
}

/** What Foundry's new-order command is given when a ticket was chosen. */
function foundryArgs(request: WorkRequest): object | undefined {
  if (request.kind !== 'ticket') return undefined
  const { tracker, key, title } = request.issue
  return { tracker, key, title, repoRoot: request.workspace.folderPath }
}

/** Foundry's own command for a new order, given the chosen ticket when there is one. */
async function startFoundryOrder(request: WorkRequest): Promise<Outcome> {
  await useExtensionCommandsStore.getState().refresh()
  const { registered } = useExtensionCommandsStore.getState()
  const command = registered.find((c) => c.category === 'Foundry' && c.id === 'new-order')
  if (command === undefined) return 'Foundry is not turned on, so it cannot take an order.'
  const repoRoot = request.workspace.folderPath
  const context = { projectId: null, sessionId: null, repoRoot }
  window.electronAPI.extension.executeCommand(command.key, context, foundryArgs(request))
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

/** Does the work. Null when it started; otherwise what to tell the person, in plain words. */
export async function startWork(request: WorkRequest): Promise<Outcome> {
  if (request.runAs === 'foundry') return startFoundryOrder(request)
  const command = commandFor(request)
  if (command instanceof Error) return command.message
  const projectId = await projectFor(request)
  if (projectId instanceof Error) return projectId.message
  const sessionId = await startSessionInBranch(projectId, command)
  if (sessionId === null) return 'The terminal could not be opened.'
  if (request.kind === 'ticket') await linkTicket(sessionId, request.issue)
  return null
}
