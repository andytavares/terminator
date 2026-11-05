import { z } from 'zod'
import { stat, readFile } from 'node:fs/promises'
import { defineChannel, type ChannelSpec, type ExtensionAPI } from '@terminator/extension-sdk'
import {
  loadLocalInventory,
  type InventoryShell,
  type WorktreeEntry,
} from '../git/local-inventory.js'
import { removeLocalItems, type RemoveShell } from '../git/remove-local.js'
import {
  anyCleanupRuleOn,
  planCleanup,
  type CleanupSettings,
  type MergedHead,
} from '../git/cleanup-plan.js'
import { runGit } from '../shell/run-git.js'
import { RepoRoot } from './repo-root.js'
import { VALIDATION_ERROR, errorEnvelope, type RegisterFn } from './register.js'

// The Worktrees tab's channels. Local-only: not in REMOTE_READ_CHANNELS.

const LocalInventoryPayload = z.object({ repoRoot: RepoRoot })

const RemoveLocalPayload = z.object({
  repoRoot: RepoRoot,
  items: z
    .array(
      z.object({
        branch: z.string().min(1).nullable(),
        worktreePath: z.string().min(1).nullable(),
        forceBranch: z.boolean(),
      })
    )
    .min(1),
})

const CleanupRunPayload = z.object({ repoRoot: RepoRoot })

/** One branch or worktree the cleanup removed or kept, and why. */
interface CleanupEntry {
  branch: string | null
  worktreePath: string | null
  reason: string
}

export interface CleanupReport {
  removed: CleanupEntry[]
  kept: CleanupEntry[]
}

/** What the cleanup reads beyond git: the rules, and GitHub's merged head branches of a repository. */
export interface CleanupDeps {
  settings: () => CleanupSettings
  mergedHeads: (repoRoot: string) => MergedHead[]
}

type Workspace = ExtensionAPI['workspace']

/** Every workspace's projects, flat: a row's Terminator card is one of these. */
function listAllProjects(workspace: Workspace) {
  return () =>
    workspace
      .list()
      .flatMap((w) =>
        workspace
          .listProjects(w.id)
          .map((p) => ({ id: p.id, name: p.name, worktreePath: p.worktreePath }))
      )
}

/** The core's worktree list for `repoRoot`; git's own order, so the first is the main checkout. */
function worktreesOf(api: Pick<ExtensionAPI, 'ipc'>) {
  return async (repoRoot: string): Promise<WorktreeEntry[]> => {
    const answer = (await api.ipc.invokeChannel('git:list-worktrees', { path: repoRoot })) as
      | {
          worktrees: Array<{
            path: string
            branch?: string
            detached?: boolean
            prunable?: boolean
          }>
        }
      | undefined
    return (answer?.worktrees ?? []).map((worktree) => ({
      path: worktree.path,
      branch: worktree.detached ? null : (worktree.branch ?? null),
      detached: worktree.detached === true,
      prunable: worktree.prunable === true,
    }))
  }
}

function inventoryShell(api: Pick<ExtensionAPI, 'workspace' | 'ipc'>): InventoryShell {
  const { workspace } = api
  return {
    exec: (cwd, args) => runGit(cwd, args, { raw: true }),
    listWorktrees: worktreesOf(api),
    stat: async (path) => {
      const times = await stat(path).catch(() => null)
      return times ? { birthtimeMs: times.birthtimeMs, mtimeMs: times.mtimeMs } : null
    },
    readFile: (path) => readFile(path, 'utf8').catch(() => null),
    listProjects: async () => listAllProjects(workspace)(),
  }
}

function removeShell(api: Pick<ExtensionAPI, 'workspace' | 'pty' | 'ipc'>): RemoveShell {
  const { workspace, pty } = api
  return {
    exec: (cwd, args) => runGit(cwd, args),
    listWorktrees: worktreesOf(api),
    listProjects: async () => listAllProjects(workspace)(),
    listSessions: async () =>
      (await pty.listSessions()).map((s) => ({ cwd: s.cwd, projectId: s.projectId })),
    deleteProject: (id) => workspace.deleteProject(id),
  }
}

type WorktreesApi = Pick<ExtensionAPI, 'workspace' | 'pty' | 'ipc'>

const REFUSAL_TEXT: Record<string, string> = { 'open session': 'An open terminal runs in it' }

/** Plans the cleanup rules and runs the plan; removeLocalItems keeps its refusals, so a worktree
 *  an open terminal runs in stays. With every rule off it reads nothing. */
async function runCleanup(
  repoRoot: string,
  api: WorktreesApi,
  deps: CleanupDeps
): Promise<CleanupReport> {
  const settings = deps.settings()
  if (!anyCleanupRuleOn(settings)) return { removed: [], kept: [] }
  const rows = await loadLocalInventory(repoRoot, inventoryShell(api))
  const mergedHeads = deps.mergedHeads(repoRoot)
  const { remove, keep } = planCleanup({ rows, mergedHeads, settings, now: Date.now() })
  const kept = keep.map(({ row, reason }) => entryOf(row, reason))
  if (remove.length === 0) return { removed: [], kept }
  const { results } = await removeLocalItems(repoRoot, removeShell(api), remove)
  const removed: CleanupEntry[] = []
  results.forEach((result, i) => {
    if (result.ok) removed.push(entryOf(remove[i], remove[i].reason))
    else kept.push(entryOf(result, REFUSAL_TEXT[result.reason ?? ''] ?? result.reason ?? 'failed'))
  })
  return { removed, kept }
}

function entryOf(
  item: { branch: string | null; worktreePath: string | null },
  reason: string
): CleanupEntry {
  return { branch: item.branch, worktreePath: item.worktreePath, reason }
}

/** git:local-inventory, git:remove-local and git:cleanup-run, the Worktrees tab's channels. */
function worktreesChannels(api: WorktreesApi, deps: CleanupDeps): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'git:local-inventory',
      schema: LocalInventoryPayload,
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot }) => ({
        rows: await loadLocalInventory(repoRoot, inventoryShell(api)),
      }),
      onError: errorEnvelope,
    }),
    defineChannel({
      channel: 'git:remove-local',
      schema: RemoveLocalPayload,
      invalid: VALIDATION_ERROR,
      run: ({ repoRoot, items }) => removeLocalItems(repoRoot, removeShell(api), items),
      onError: errorEnvelope,
    }),
    defineChannel({
      channel: 'git:cleanup-run',
      schema: CleanupRunPayload,
      invalid: VALIDATION_ERROR,
      run: ({ repoRoot }) => runCleanup(repoRoot, api, deps),
      onError: errorEnvelope,
    }),
  ]
}

export function registerWorktreesHandlers(
  register: RegisterFn,
  api: WorktreesApi,
  deps: CleanupDeps
): void {
  for (const spec of worktreesChannels(api, deps)) register(spec)
}
