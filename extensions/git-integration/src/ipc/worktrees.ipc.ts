import { z } from 'zod'
import { stat, readFile } from 'node:fs/promises'
import { defineChannel, type ChannelSpec, type ExtensionAPI } from '@terminator/extension-sdk'
import {
  loadLocalInventory,
  type InventoryShell,
  type WorktreeEntry,
} from '../git/local-inventory.js'
import { removeLocalItems, type RemoveShell } from '../git/remove-local.js'
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

/** git:local-inventory and git:remove-local, the Worktrees tab's two channels. */
function worktreesChannels(api: Pick<ExtensionAPI, 'workspace' | 'pty' | 'ipc'>): ChannelSpec[] {
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
  ]
}

export function registerWorktreesHandlers(
  register: RegisterFn,
  api: Pick<ExtensionAPI, 'workspace' | 'pty' | 'ipc'>
): void {
  for (const spec of worktreesChannels(api)) register(spec)
}
