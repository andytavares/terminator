import { z } from 'zod'
import { stat, readFile } from 'node:fs/promises'
import { defineChannel, type ChannelSpec, type ExtensionAPI } from '@terminator/extension-sdk'
import { loadLocalInventory, type InventoryShell } from '../git/local-inventory.js'
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
        forceWorktree: z.boolean(),
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

function inventoryShell(workspace: Workspace): InventoryShell {
  return {
    exec: (cwd, args) => runGit(cwd, args, { raw: true }),
    stat: async (path) => {
      const times = await stat(path).catch(() => null)
      return times ? { birthtimeMs: times.birthtimeMs, mtimeMs: times.mtimeMs } : null
    },
    readFile: (path) => readFile(path, 'utf8').catch(() => null),
    listProjects: async () => listAllProjects(workspace)(),
  }
}

function removeShell(workspace: Workspace): RemoveShell {
  return {
    exec: (cwd, args) => runGit(cwd, args),
    listProjects: async () => listAllProjects(workspace)(),
    deleteProject: (id) => workspace.deleteProject(id),
  }
}

/** git:local-inventory and git:remove-local, the Worktrees tab's two channels. */
function worktreesChannels(workspace: Workspace): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'git:local-inventory',
      schema: LocalInventoryPayload,
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot }) => ({
        rows: await loadLocalInventory(repoRoot, inventoryShell(workspace)),
      }),
      onError: errorEnvelope,
    }),
    defineChannel({
      channel: 'git:remove-local',
      schema: RemoveLocalPayload,
      invalid: VALIDATION_ERROR,
      run: ({ repoRoot, items }) => removeLocalItems(repoRoot, removeShell(workspace), items),
      onError: errorEnvelope,
    }),
  ]
}

export function registerWorktreesHandlers(register: RegisterFn, workspace: Workspace): void {
  for (const spec of worktreesChannels(workspace)) register(spec)
}
