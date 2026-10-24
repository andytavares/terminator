import { useWorkspaceStore } from '../../stores/workspace.store'
import { useTaskStore } from '../../stores/task.store'
import { startWork, type RunAs } from './start-work'
import type { TaskCreateInput } from '../../../shared/schemas/tasks.schema'
import type { Workspace } from '../../../shared/types/index'

// What Start work → Across repos decides and does, apart from how it is drawn.

/** The branch name a title suggests: "Rate limits across services" is rate-limits-across-services. */
export function branchSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface AcrossRequest {
  title: string
  branch: string
  ticket: TaskCreateInput['ticket']
  /** What each agent is first told; empty starts it with nothing. */
  prompt: string
  runAs: RunAs
  workspaces: Workspace[]
}

/** Messages by workspace id: why a repo cannot start, or what happened to it. */
export type RepoMessages = Map<string, string>

export interface AcrossResult {
  /** Why no repo was started, when one could not take the branch. */
  problems: RepoMessages
  /** The repos whose lane could not be made, after the others were. */
  failures: RepoMessages
  started: Workspace[]
  /** Whether the one task holding the started lanes was saved. */
  recorded: boolean
}

const hasBranchCard = (workspace: Workspace, branch: string): boolean =>
  (useWorkspaceStore.getState().projectsByWorkspaceId.get(workspace.id) ?? []).some(
    (project) => project.gitBranch === branch
  )

/** Why this repo cannot take the branch, in plain words; null when it can. */
async function problemWith(workspace: Workspace, branch: string): Promise<string | null> {
  const repo = await window.electronAPI.git.isRepo(workspace.folderPath)
  if ('error' in repo) return `Could not read the git repository of ${workspace.name}.`
  if (!repo.isRepo || !repo.root) return `${workspace.name} is not a git repo.`
  if (hasBranchCard(workspace, branch)) return null
  const { worktrees } = await window.electronAPI.git.listWorktrees(repo.root)
  const taken = worktrees.find((w) => w.branch === branch)
  return taken === undefined
    ? null
    : `${branch} is already checked out in ${taken.path}. Use another branch name.`
}

/** Every repo that cannot take the branch, checked before anything starts. */
async function checkRepos(workspaces: Workspace[], branch: string): Promise<RepoMessages> {
  const found = await Promise.all(workspaces.map((w) => problemWith(w, branch)))
  const problems: RepoMessages = new Map()
  workspaces.forEach((workspace, i) => {
    const problem = found[i]
    if (problem !== null) problems.set(workspace.id, problem)
  })
  return problems
}

/** Starts the branch in each repo one after another (git takes a lock per repo); keeps going past a failure. */
async function startLanes(request: AcrossRequest) {
  const started: Workspace[] = []
  const failures: RepoMessages = new Map()
  const prompt = request.prompt.trim() === '' ? undefined : request.prompt
  for (const workspace of request.workspaces) {
    const message = await startWork({
      kind: 'branch',
      branch: request.branch,
      prompt,
      workspace,
      runAs: request.runAs,
    })
    if (message === null) started.push(workspace)
    else failures.set(workspace.id, message)
  }
  return { started, failures }
}

/** Starts one lane per repo and records one task holding exactly the lanes that were made. */
export async function startAcrossRepos(request: AcrossRequest): Promise<AcrossResult> {
  const problems = await checkRepos(request.workspaces, request.branch)
  if (problems.size > 0) return { problems, failures: new Map(), started: [], recorded: false }
  const { started, failures } = await startLanes(request)
  const lanes = started.map((w) => ({ repoRoot: w.folderPath, branch: request.branch }))
  const recorded =
    lanes.length > 0 &&
    (await useTaskStore.getState().create({ title: request.title, lanes, ticket: request.ticket }))
  return { problems, failures, started, recorded }
}
